import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { bookingActor, lockBookingTrip } from "@/server/auth/booking-access";
import {
  bookingTermsSchema,
  hashBookingTerms,
  canonicalBookingJson,
  currentWholeTripCoverage,
  isWholeTripTerms,
  type BookingAuthorization,
  type BookingOperation,
} from "@/domain/booking/authorization";
import { ProblemError } from "@/server/errors";
import { BookingRepository } from "@/server/db/booking-repository";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { inTransaction } from "@/server/db/transaction";
import { IdempotencyRepository } from "@/server/db/idempotency-repository";
import { assertTrustedBookingPrerequisites } from "@/server/supply/payment";

import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import type { BookingActor } from "@/server/auth/planning-actor";
import type { TrustedBookingPrerequisiteReader } from "@/server/supply/payment";

export const bookingAuthorizationRequestSchema = z
  .object({
    requestId: z.uuid(),
    tripVersion: z.number().int().positive(),
    termsHash: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.enum(["book_trip", "reschedule_component", "cancel_component"]),
    componentId: z.uuid().nullable(),
    acknowledgedNonReversibleActions: z.array(z.uuid()).max(32),
  })
  .strict()
  .superRefine((request, context) => {
    if ((request.operation === "book_trip") !== (request.componentId === null))
      context.addIssue({
        code: "custom",
        path: ["componentId"],
        message: "Whole-trip consent cannot select a component",
      });
    if (
      new Set(request.acknowledgedNonReversibleActions).size !==
      request.acknowledgedNonReversibleActions.length
    )
      context.addIssue({
        code: "custom",
        path: ["acknowledgedNonReversibleActions"],
        message: "Acknowledgements must be unique",
      });
  });

export interface BookingAuthorizationRequest {
  requestId: string;
  tripVersion: number;
  termsHash: string;
  operation: BookingOperation;
  componentId: string | null;
  acknowledgedNonReversibleActions: string[];
}

export interface BookingAuthorizationReceipt {
  id: string;
  tripId: string;
  tripVersion: number;
  operation: BookingOperation;
  componentId: string | null;
  termsHash: string;
  status: "authorized";
  authorizedAt: string;
  expiresAt: string;
}
export const bookingAuthorizationReceiptSchema = z
  .object({
    id: z.uuid(),
    tripId: z.uuid(),
    tripVersion: z.number().int().positive(),
    operation: z.enum(["book_trip", "reschedule_component", "cancel_component"]),
    componentId: z.uuid().nullable(),
    termsHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.literal("authorized"),
    authorizedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export async function authorizeBooking(
  database: Kysely<Database>,
  proof: string | BookingActor,
  tripId: string,
  raw: unknown,
  now = new Date(),
  prerequisites?: TrustedBookingPrerequisiteReader,
): Promise<BookingAuthorizationReceipt> {
  const input = bookingAuthorizationRequestSchema.parse(raw);
  const actor = await bookingActor(database, proof, tripId),
    userId = actor.accountUserId;
  return inTransaction(database, async (transaction) => {
    const trip = await lockBookingTrip(transaction, actor, tripId);
    if (!trip)
      throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
    const scope = `booking.authorization:${userId}:${tripId}`;
    const fingerprint = createHash("sha256")
      .update(
        canonicalBookingJson({
          ownerUserId: userId,
          tripId,
          ...input,
        }),
      )
      .digest("hex");
    const idempotency = new IdempotencyRepository(transaction);
    const claim = await idempotency.claim({
      scope,
      key: input.requestId,
      requestFingerprint: fingerprint,
      expiresAt: new Date(now.getTime() + 86_400_000),
    });
    if (claim.kind === "replay") return bookingAuthorizationReceiptSchema.parse(claim.result);
    if (
      trip.currentVersion !== input.tripVersion ||
      !["finalized", "partially_booked", "booked"].includes(trip.lifecycleState)
    ) {
      throw new ProblemError({
        title: "Booking terms are stale",
        status: 409,
        code: "booking_terms_stale",
      });
    }
    const version = await readOwnedTripVersion(transaction, actor.planningOwnerId, tripId);
    const snapshot = tripSnapshotSchema.parse(version.snapshot);
    if (
      snapshot.constraints.some(
        (constraint) =>
          constraint.source.kind === "system_inference" &&
          constraint.priority !== "preference" &&
          !constraint.confirmedByUser,
      )
    ) {
      throw new ProblemError({
        title: "Trip needs constraint review",
        status: 409,
        code: "booking_constraints_unconfirmed",
      });
    }
    const revalidation = await transaction
      .selectFrom("bookingRevalidations")
      .selectAll()
      .where("tripId", "=", tripId)
      .where("ownerUserId", "=", userId)
      .where("tripVersion", "=", input.tripVersion)
      .orderBy("createdAt", "desc")
      .orderBy("workflowId", "desc")
      .forUpdate()
      .executeTakeFirst();
    if (
      !revalidation?.terms ||
      revalidation.status !== "completed" ||
      revalidation.termsHash !== input.termsHash ||
      !revalidation.expiresAt ||
      revalidation.expiresAt.getTime() <= now.getTime()
    )
      throw new ProblemError({
        title: "Live terms expired or changed",
        status: 409,
        code: "booking_terms_stale",
      });
    const terms = bookingTermsSchema.parse(revalidation.terms);
    if (hashBookingTerms(terms) !== input.termsHash)
      throw new ProblemError({
        title: "Live terms hash is invalid",
        status: 409,
        code: "booking_terms_stale",
      });
    if (input.operation === "book_trip") {
      if (!isWholeTripTerms(terms))
        throw new ProblemError({
          title: "A fresh whole-trip review is required",
          status: 409,
          code: "booking_legacy_review_required",
        });
      const coverage = currentWholeTripCoverage(terms, snapshot, input.tripVersion, now);
      if (
        !coverage.eligible ||
        canonicalBookingJson(coverage) !== canonicalBookingJson(terms.coverage) ||
        terms.tripVersion !== input.tripVersion
      )
        throw new ProblemError({
          title: "Complete booking requirements changed",
          status: 409,
          code: "booking_coverage_changed",
          detail:
            "Resolve all missing or unverified requirements and refresh the whole-trip review.",
        });
      if (terms.continuationOf !== null || terms.rootAttemptId !== null)
        throw new ProblemError({
          title: "Booking continuation is not activated",
          status: 409,
          code: "booking_continuation_unavailable",
        });
      await new BookingRepository(transaction).assertConfirmedBasis(tripId, terms);
      await assertTrustedBookingPrerequisites(prerequisites, userId, tripId, terms);
    }
    if (input.operation === "book_trip" && input.componentId !== null)
      throw new ProblemError({
        title: "Invalid booking operation",
        status: 400,
        code: "invalid_booking_operation",
      });
    if (input.operation !== "book_trip" && input.componentId === null)
      throw new ProblemError({
        title: "A component is required",
        status: 400,
        code: "component_required",
      });
    if (
      input.componentId &&
      !terms.components.some((component) => component.componentId === input.componentId)
    ) {
      throw new ProblemError({
        title: "Component is not included in these terms",
        status: 409,
        code: "booking_component_mismatch",
      });
    }
    const required = terms.nonReversibleActions;
    if (
      canonicalBookingJson([...required].sort()) !==
      canonicalBookingJson([...input.acknowledgedNonReversibleActions].sort())
    ) {
      throw new ProblemError({
        title: "Acknowledge each non-reversible action",
        status: 409,
        code: "booking_acknowledgement_required",
      });
    }
    const checkedAt = new Date(Math.max(now.getTime(), Date.now()));
    if (
      revalidation.expiresAt!.getTime() <= checkedAt.getTime() ||
      (isWholeTripTerms(terms) &&
        !currentWholeTripCoverage(terms, snapshot, input.tripVersion, checkedAt).eligible)
    )
      throw new ProblemError({
        title: "Live terms expired during authorization",
        status: 409,
        code: "booking_terms_stale",
      });
    const authorizedAt = checkedAt.toISOString();
    const authorization: BookingAuthorization = {
      id: randomUUID(),
      tripId,
      userId,
      tripVersion: input.tripVersion,
      operation: input.operation,
      componentId: input.componentId,
      terms,
      termsHash: input.termsHash,
      acknowledgedNonReversibleActions: input.acknowledgedNonReversibleActions,
      status: "authorized",
      reason: null,
      authorizedAt,
      expiresAt: new Date(
        Math.min(revalidation.expiresAt!.getTime(), now.getTime() + 5 * 60_000),
      ).toISOString(),
    };
    await new BookingRepository(transaction).insertAuthorization(authorization, {
      requestId: input.requestId,
      requestFingerprint: fingerprint,
    });
    await transaction
      .insertInto("auditEvents")
      .values({
        id: randomUUID(),
        actorType: "user",
        actorId: userId,
        action: "booking.terms.authorized",
        targetType: "trip",
        targetId: tripId,
        requestId: input.requestId,
        traceId: null,
        outcome: "succeeded",
        metadata: {
          authorizationId: authorization.id,
          operation: input.operation,
          termsHash: input.termsHash,
          tripVersion: input.tripVersion,
        },
        occurredAt: now,
      })
      .execute();
    const receipt: BookingAuthorizationReceipt = {
      id: authorization.id,
      tripId: authorization.tripId,
      tripVersion: authorization.tripVersion,
      operation: authorization.operation,
      componentId: authorization.componentId,
      termsHash: authorization.termsHash,
      status: "authorized",
      authorizedAt: authorization.authorizedAt,
      expiresAt: authorization.expiresAt,
    };
    await idempotency.complete(scope, input.requestId, fingerprint, { ...receipt });
    return receipt;
  });
}
