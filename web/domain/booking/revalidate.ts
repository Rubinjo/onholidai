import { createHash, randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { z } from "zod";

import { bookingActor, lockBookingTrip } from "@/server/auth/booking-access";
import { ProblemError } from "@/server/errors";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { startWorkflow } from "@/server/workflows/client";
import { inTransaction } from "@/server/db/transaction";
import { BookingRepository } from "@/server/db/booking-repository";
import { publicSupplierText } from "@/lib/privacy";

import {
  bookingComponentTermsSchema,
  bookingTermsSchema,
  currentWholeTripCoverage,
  isWholeTripTerms,
  projectBookingTerms,
} from "./authorization";
import { deriveBookingCoverage } from "../trip/booking-coverage";
import {
  bookingReviewStateSchema,
  projectBookingCoverage,
  projectRevalidationOutcomes,
} from "./public";
import { projectBookingTransactionRow, projectPublicBookingTransaction } from "./schema";

import type { Database } from "@/server/db/database";
import type { BookingActor } from "@/server/auth/planning-actor";

export async function readBookingReview(
  database: Kysely<Database>,
  proof: string | BookingActor,
  tripId: string,
  now = new Date(),
) {
  const actor = await bookingActor(database, proof, tripId);
  return inTransaction(database, async (transaction) => {
    const current = await readOwnedTripVersion(transaction, actor.planningOwnerId, tripId);
    const snapshot = tripSnapshotSchema.parse(current.snapshot);
    const records = await new BookingRepository(transaction).reviewRecords(
      tripId,
      actor.accountUserId,
      current.version,
    );
    const terms = records.review?.terms ? bookingTermsSchema.parse(records.review.terms) : null;
    const coverage =
      terms && isWholeTripTerms(terms) && records.review?.tripVersion === current.version
        ? currentWholeTripCoverage(terms, snapshot, current.version, now)
        : deriveBookingCoverage(snapshot, { tripVersion: current.version, now });
    const projectAttempt = (row: NonNullable<typeof records.active>) =>
      projectPublicBookingTransaction(
        projectBookingTransactionRow(row),
        new Set(
          records.dispatched
            .filter((entry) => entry.transactionId === row.id)
            .map((entry) => entry.componentId),
        ),
      );
    const authorization = records.authorization;
    const latestAttempt = records.history.find(
      (candidate) => !records.history.some((child) => child.continuationOf === candidate.id),
    );
    return bookingReviewStateSchema.parse({
      tripId,
      tripVersion: current.version,
      coverage: projectBookingCoverage(coverage),
      review: records.review
        ? {
            workflowId: records.review.workflowId,
            tripId,
            tripVersion: records.review.tripVersion,
            status: records.review.status,
            outcomes: projectRevalidationOutcomes(records.review.outcomes),
            termsHash: records.review.termsHash,
            terms: terms ? projectBookingTerms(terms) : null,
            expiresAt: records.review.expiresAt?.toISOString() ?? null,
            coverage: projectBookingCoverage(coverage),
          }
        : null,
      authorization: authorization
        ? {
            id: authorization.id,
            tripId,
            tripVersion: authorization.tripVersion,
            operation: authorization.operation,
            componentId: authorization.componentId,
            termsHash: authorization.termsHash,
            status:
              authorization.status === "authorized" &&
              authorization.expiresAt.getTime() <= now.getTime()
                ? "expired"
                : authorization.status,
            requestId: authorization.requestId,
            authorizedAt: authorization.authorizedAt.toISOString(),
            expiresAt: authorization.expiresAt.toISOString(),
          }
        : null,
      activeAttempt: records.active ? projectAttempt(records.active) : null,
      latestAttempt: latestAttempt ? projectAttempt(latestAttempt) : null,
      history: records.history.map(projectAttempt),
      confirmedCommitments: records.confirmations.map((confirmation) => {
        const saved = bookingComponentTermsSchema.parse(confirmation.terms);
        return {
          id: confirmation.id,
          componentId: confirmation.componentId,
          providerReference: publicSupplierText(confirmation.providerReference),
          serviceStart: saved.serviceStart,
          serviceEnd: saved.serviceEnd,
          travellerIds: saved.travellerIds,
          finalCustomerMinor: saved.finalCustomerMinor,
          currency: saved.currency,
          cancellationTerms: publicSupplierText(saved.cancellationTerms),
          confirmedAt: confirmation.confirmedAt.toISOString(),
        };
      }),
    });
  });
}

const requestSchema = z
  .object({ requestId: z.uuid(), expectedVersion: z.number().int().positive() })
  .strict();

export async function startBookingRevalidation(
  database: Kysely<Database>,
  proof: string | BookingActor,
  tripId: string,
  raw: unknown,
) {
  const input = requestSchema.parse(raw);
  const actor = await bookingActor(database, proof, tripId),
    userId = actor.accountUserId;
  const requestFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        userId,
        tripId,
        requestId: input.requestId,
        expectedVersion: input.expectedVersion,
      }),
    )
    .digest("hex");
  const workflowId = randomUUID();
  const record = await inTransaction(database, async (transaction) => {
    const trip = await lockBookingTrip(transaction, actor, tripId);
    if (!trip)
      throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
    if (
      trip.currentVersion !== input.expectedVersion ||
      !["finalized", "partially_booked", "booked"].includes(trip.lifecycleState)
    ) {
      throw new ProblemError({
        title: "Trip state changed before live revalidation",
        status: 409,
        code: "booking_trip_not_available",
      });
    }
    const prior = await transaction
      .selectFrom("bookingRevalidations")
      .selectAll()
      .where("tripId", "=", tripId)
      .where("requestId", "=", input.requestId)
      .forUpdate()
      .executeTakeFirst();
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint)
        throw new ProblemError({
          title: "Request ID was reused with different booking terms",
          status: 409,
          code: "idempotency_conflict",
        });
      return prior;
    }
    await new BookingRepository(transaction).wholeTripLineage(tripId, userId);
    const snapshot = tripSnapshotSchema.parse(
      (await readOwnedTripVersion(transaction, actor.planningOwnerId, tripId)).snapshot,
    );
    if (!snapshot.components.length)
      throw new ProblemError({
        title: "No bookable components",
        status: 409,
        code: "booking_components_missing",
      });
    await transaction
      .insertInto("bookingRevalidations")
      .values({
        workflowId,
        tripId,
        ownerUserId: userId,
        requestId: input.requestId,
        requestFingerprint,
        tripVersion: input.expectedVersion,
        status: "accepted",
        outcomes: sql<unknown[]>`${JSON.stringify([])}::jsonb`,
        terms: null,
        termsHash: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();
    await transaction
      .insertInto("outboxEvents")
      .values({
        id: randomUUID(),
        eventType: "booking.revalidation.requested",
        eventVersion: 1,
        aggregateType: "trip",
        aggregateId: tripId,
        aggregateVersion: input.expectedVersion,
        payload: { workflowId, tripId, ownerUserId: userId, tripVersion: input.expectedVersion },
        leaseExpiresAt: null,
        deliveredAt: null,
        lastErrorCategory: null,
      })
      .execute();
    return {
      workflowId,
      tripId,
      ownerUserId: userId,
      tripVersion: input.expectedVersion,
      status: "accepted" as const,
    };
  });
  // Revalidation is durable before Temporal is contacted. A retry uses the same workflow id.
  try {
    await startWorkflow(
      "revalidateBooking",
      record.workflowId,
      process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking",
      {
        workflowId: record.workflowId,
        tripId,
        ownerUserId: userId,
        tripVersion: input.expectedVersion,
      },
    );
  } catch {
    // The durable accepted record and outbox event let the worker dispatcher recover startup failures.
  }
  return { workflowId: record.workflowId, status: record.status };
}
