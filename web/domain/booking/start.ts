import { randomUUID } from "node:crypto";

import { z } from "zod";

import { bookingActor, lockBookingTrip } from "@/server/auth/booking-access";
import {
  bookingTermsSchema,
  canonicalBookingJson,
  currentWholeTripCoverage,
  hashBookingTerms,
  isWholeTripTerms,
  type BookingAuthorization,
} from "@/domain/booking/authorization";
import {
  bookingTransactionSchema,
  projectBookingTransactionRow,
  type BookingTransaction,
} from "@/domain/booking/schema";
import { inTransaction } from "@/server/db/transaction";
import { BookingRepository } from "@/server/db/booking-repository";
import { ProblemError } from "@/server/errors";
import { startWorkflow } from "@/server/workflows/client";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { assertTrustedBookingPrerequisites } from "@/server/supply/payment";

import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import type { BookingActor } from "@/server/auth/planning-actor";
import type { TrustedBookingPrerequisiteReader } from "@/server/supply/payment";

const startSchema = z.object({ requestId: z.uuid(), authorizationId: z.uuid() }).strict();

export async function startBooking(
  database: Kysely<Database>,
  proof: string | BookingActor,
  tripId: string,
  raw: unknown,
  options: { prerequisites?: TrustedBookingPrerequisiteReader; now?: Date } = {},
): Promise<BookingTransaction> {
  const input = startSchema.parse(raw);
  const actor = await bookingActor(database, proof, tripId),
    userId = actor.accountUserId;
  const result = await inTransaction(database, async (transaction) => {
    const trip = await lockBookingTrip(transaction, actor, tripId);
    if (!trip)
      throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
    const priorRequest = await transaction
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("tripId", "=", tripId)
      .where("ownerUserId", "=", userId)
      .where("requestId", "=", input.requestId)
      .executeTakeFirst();
    if (priorRequest && priorRequest.authorizationId !== input.authorizationId)
      throw new ProblemError({
        title: "Start request was reused for different consent",
        status: 409,
        code: "idempotency_fingerprint_conflict",
      });
    const existing = await transaction
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("authorizationId", "=", input.authorizationId)
      .where("ownerUserId", "=", userId)
      .where("tripId", "=", tripId)
      .executeTakeFirst();
    if (existing) return projectBookingTransactionRow(existing);
    const row = await new BookingRepository(transaction).getAuthorizationForUpdate(
      input.authorizationId,
      tripId,
      userId,
    );
    if (!row)
      throw new ProblemError({
        title: "Booking authorization not found",
        status: 404,
        code: "booking_authorization_not_found",
      });
    const authorization: BookingAuthorization = {
      id: row.id,
      tripId: row.tripId,
      userId: row.ownerUserId,
      tripVersion: row.tripVersion,
      operation: row.operation,
      componentId: row.componentId,
      terms: bookingTermsSchema.parse(row.terms),
      termsHash: row.termsHash,
      acknowledgedNonReversibleActions: row.acknowledgedNonReversibleActions,
      status: row.status,
      reason: row.reason,
      authorizedAt: row.authorizedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
    let now = options.now ?? new Date();
    if (
      trip.currentVersion !== authorization.tripVersion ||
      !["finalized", "partially_booked", "booked"].includes(trip.lifecycleState) ||
      authorization.status !== "authorized" ||
      hashBookingTerms(authorization.terms) !== authorization.termsHash ||
      Date.parse(authorization.expiresAt) <= now.getTime()
    ) {
      throw new ProblemError({
        title: "Booking authorization is stale or expired",
        status: 409,
        code: "booking_authorization_stale",
      });
    }
    const transactionId = randomUUID();
    const workflowId = `booking-${transactionId}`;
    const currentVersion = await readOwnedTripVersion(transaction, actor.planningOwnerId, tripId);
    const currentSnapshot = tripSnapshotSchema.parse(currentVersion.snapshot);
    if (authorization.operation === "book_trip") {
      if (!isWholeTripTerms(authorization.terms))
        throw new ProblemError({
          title: "A fresh whole-trip review is required",
          status: 409,
          code: "booking_legacy_review_required",
        });
      const latestReview = await transaction
        .selectFrom("bookingRevalidations")
        .select(["status", "termsHash", "expiresAt"])
        .where("tripId", "=", tripId)
        .where("ownerUserId", "=", userId)
        .where("tripVersion", "=", trip.currentVersion)
        .orderBy("createdAt", "desc")
        .orderBy("workflowId", "desc")
        .forUpdate()
        .executeTakeFirst();
      if (
        !latestReview ||
        latestReview.status !== "completed" ||
        latestReview.termsHash !== authorization.termsHash ||
        !latestReview.expiresAt ||
        latestReview.expiresAt.getTime() <= now.getTime()
      )
        throw new ProblemError({
          title: "The latest whole-trip terms changed or expired",
          status: 409,
          code: "booking_terms_stale",
        });
      const coverage = currentWholeTripCoverage(
        authorization.terms,
        currentSnapshot,
        trip.currentVersion,
        now,
      );
      if (
        !coverage.eligible ||
        canonicalBookingJson(coverage) !== canonicalBookingJson(authorization.terms.coverage) ||
        authorization.terms.tripVersion !== trip.currentVersion
      )
        throw new ProblemError({
          title: "The exact complete booking basis changed",
          status: 409,
          code: "booking_coverage_changed",
        });
      await new BookingRepository(transaction).assertWholeTripLineage(
        tripId,
        userId,
        authorization.terms,
        now,
      );
      await new BookingRepository(transaction).assertConfirmedBasis(tripId, authorization.terms);
      await assertTrustedBookingPrerequisites(
        options.prerequisites,
        userId,
        tripId,
        authorization.terms,
      );
      now = new Date(Math.max(now.getTime(), Date.now()));
      if (
        Date.parse(authorization.expiresAt) <= now.getTime() ||
        !currentWholeTripCoverage(authorization.terms, currentSnapshot, trip.currentVersion, now)
          .eligible
      )
        throw new ProblemError({
          title: "Booking authorization expired before start",
          status: 409,
          code: "booking_authorization_stale",
        });
    }
    const authorizedComponents =
      authorization.operation === "book_trip" && isWholeTripTerms(authorization.terms)
        ? authorization.terms.components.filter((term) => term.disposition === "to_book")
        : authorization.terms.components.filter(
            (component) => component.componentId === authorization.componentId,
          );
    if (authorization.operation === "book_trip" && authorizedComponents.length === 0) {
      throw new ProblemError({
        title: "No unbooked components remain",
        status: 409,
        code: "booking_components_already_confirmed",
      });
    }
    if (authorizedComponents.length === 0)
      throw new ProblemError({
        title: "Authorized component is missing",
        status: 409,
        code: "booking_component_mismatch",
      });
    const components = authorizedComponents.map((component) => ({
      componentId: component.componentId,
      status: "authorized" as const,
      providerReference: null,
      safeReason:
        authorization.operation === "book_trip"
          ? "Not attempted. Whole-trip provider execution is not activated."
          : null,
    }));
    const booking = bookingTransactionSchema.parse({
      id: transactionId,
      tripId,
      authorizationId: authorization.id,
      operation: authorization.operation,
      status: "requested",
      components,
      startedAt: now.toISOString(),
      completedAt: null,
      executionBasis: {
        ownerUserId: userId,
        operation: authorization.operation,
        authorizationId: authorization.id,
        startingTripVersion: authorization.tripVersion,
        terms: authorization.terms,
        termsHash: authorization.termsHash,
        expiresAt: authorization.expiresAt,
      },
      lastObservedTripVersion: authorization.tripVersion,
      executionStatus: authorization.operation === "book_trip" ? "invalidated" : "active",
      workflowId,
      requestId: input.requestId,
    });
    const claimed = await new BookingRepository(transaction).startTransaction({
      transaction: booking,
      ownerUserId: userId,
    });
    if (!claimed)
      throw new ProblemError({
        title: "Booking authorization was already consumed or expired",
        status: 409,
        code: "booking_authorization_consumed",
      });
    await transaction
      .insertInto("outboxEvents")
      .values({
        id: randomUUID(),
        eventType: "booking.transaction.requested",
        eventVersion: 1,
        aggregateType: "trip",
        aggregateId: tripId,
        aggregateVersion: trip.currentVersion,
        payload: { transactionId, workflowId, operation: authorization.operation },
        leaseExpiresAt: null,
        deliveredAt: null,
        lastErrorCategory: null,
      })
      .execute();
    return booking;
  });
  if (isWholeTripTerms(result.executionBasis.terms)) return result;
  try {
    await startWorkflow(
      "bookTrip",
      result.workflowId,
      process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking",
      { transactionId: result.id },
    );
  } catch {
    // Transaction and outbox are durable; dispatcher reconciliation can start it later.
  }
  return result;
}
