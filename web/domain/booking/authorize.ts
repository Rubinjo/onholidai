import { randomUUID } from "node:crypto";

import { z } from "zod";

import { bookingActor, lockBookingTrip } from "@/server/auth/booking-access";
import {
  bookingTermsSchema,
  hashBookingTerms,
  type BookingAuthorization,
  type BookingOperation,
} from "@/domain/booking/authorization";
import { ProblemError } from "@/server/errors";
import { BookingRepository } from "@/server/db/booking-repository";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { inTransaction } from "@/server/db/transaction";

import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import type { BookingActor } from "@/server/auth/planning-actor";

export const bookingAuthorizationRequestSchema = z
  .object({
    requestId: z.uuid(),
    tripVersion: z.number().int().positive(),
    termsHash: z.string().regex(/^[a-f0-9]{64}$/),
    operation: z.enum(["book_trip", "reschedule_component", "cancel_component"]),
    componentId: z.uuid().nullable(),
    acknowledgedNonReversibleActions: z.array(z.uuid()).max(32),
  })
  .strict();

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

export async function authorizeBooking(
  database: Kysely<Database>,
  proof: string | BookingActor,
  tripId: string,
  raw: unknown,
  now = new Date(),
): Promise<BookingAuthorizationReceipt> {
  const input = bookingAuthorizationRequestSchema.parse(raw);
  const actor = await bookingActor(database, proof, tripId),
    userId = actor.accountUserId;
  return inTransaction(database, async (transaction) => {
    const trip = await lockBookingTrip(transaction, actor, tripId);
    if (!trip)
      throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
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
      .where("termsHash", "=", input.termsHash)
      .where("status", "=", "completed")
      .where("expiresAt", ">", now)
      .orderBy("updatedAt", "desc")
      .forUpdate()
      .executeTakeFirst();
    if (!revalidation?.terms)
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
    if (required.some((id) => !input.acknowledgedNonReversibleActions.includes(id))) {
      throw new ProblemError({
        title: "Acknowledge each non-reversible action",
        status: 409,
        code: "booking_acknowledgement_required",
      });
    }
    const authorizedAt = now.toISOString();
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
    await new BookingRepository(transaction).insertAuthorization(authorization);
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
    return {
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
  });
}
