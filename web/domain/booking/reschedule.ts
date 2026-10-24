import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { z } from "zod";

import { bookingActor, lockBookingTrip } from "@/server/auth/booking-access";
import { ProblemError } from "@/server/errors";
import { startWorkflow } from "@/server/workflows/client";
import { inTransaction } from "@/server/db/transaction";
import { canonicalBookingJson } from "@/domain/booking/authorization";
import { MAX_SUPPLIER_ID_LENGTH } from "@/domain/trip/schema";

import type { Database } from "@/server/db/database";
import type { BookingActor } from "@/server/auth/planning-actor";

const rescheduleSchema = z
  .object({
    requestId: z.uuid(),
    requestedChange: z
      .object({
        serviceStart: z.iso.datetime({ offset: true }).optional(),
        serviceEnd: z.iso.datetime({ offset: true }).optional(),
        supplierOfferId: z.string().min(1).max(MAX_SUPPLIER_ID_LENGTH).optional(),
        travellerIds: z.array(z.uuid()).min(1).max(10).optional(),
        note: z.string().max(500).optional(),
      })
      .strict()
      .refine(
        (change) => Object.keys(change).length > 0,
        "At least one requested change is required",
      ),
  })
  .strict();

export async function startComponentRescheduleRevalidation(
  database: Kysely<Database>,
  proof: string | BookingActor,
  bookingId: string,
  componentId: string,
  raw: unknown,
) {
  const input = rescheduleSchema.parse(raw),
    workflowId = randomUUID();
  const accountUserId = typeof proof === "string" ? proof : proof.accountUserId;
  const reference = await database
    .selectFrom("bookingTransactions")
    .select("tripId")
    .where("id", "=", bookingId)
    .where("ownerUserId", "=", accountUserId)
    .executeTakeFirst();
  if (!reference)
    throw new ProblemError({ title: "Booking not found", status: 404, code: "booking_not_found" });
  const actor = await bookingActor(database, proof, reference.tripId),
    userId = actor.accountUserId;
  const requestFingerprint = createHash("sha256")
    .update(canonicalBookingJson({ userId, bookingId, componentId, input }))
    .digest("hex");
  const revalidation = await inTransaction(database, async (transaction) => {
    const trip = await lockBookingTrip(transaction, actor, reference.tripId);
    const booking = await transaction
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", bookingId)
      .where("ownerUserId", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (!booking)
      throw new ProblemError({
        title: "Booking not found",
        status: 404,
        code: "booking_not_found",
      });
    if (
      !(booking.components as Array<{ componentId: string; status: string }>).some(
        (item) => item.componentId === componentId && item.status === "confirmed",
      )
    ) {
      throw new ProblemError({
        title: "Only a confirmed component can be rescheduled",
        status: 409,
        code: "booking_component_not_confirmed",
      });
    }
    if (!trip || !["booked", "partially_booked"].includes(trip.lifecycleState)) {
      throw new ProblemError({
        title: "Trip is not available for rescheduling",
        status: 409,
        code: "reschedule_trip_unavailable",
      });
    }
    const prior = await transaction
      .selectFrom("bookingRevalidations")
      .selectAll()
      .where("tripId", "=", booking.tripId)
      .where("requestId", "=", input.requestId)
      .forUpdate()
      .executeTakeFirst();
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint)
        throw new ProblemError({
          title: "Request ID was reused with different reschedule terms",
          status: 409,
          code: "idempotency_conflict",
        });
      return { ...prior, bookingId, componentId, requestedChange: input.requestedChange };
    }
    await transaction
      .insertInto("bookingRevalidations")
      .values({
        workflowId,
        tripId: booking.tripId,
        ownerUserId: userId,
        requestId: input.requestId,
        requestFingerprint,
        tripVersion: trip.currentVersion,
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
        eventType: "booking.reschedule.revalidation.requested",
        eventVersion: 1,
        aggregateType: "trip",
        aggregateId: booking.tripId,
        aggregateVersion: trip.currentVersion,
        payload: {
          workflowId,
          bookingId,
          componentId,
          ownerUserId: userId,
          tripVersion: trip.currentVersion,
          requestedChange: input.requestedChange,
        },
        leaseExpiresAt: null,
        deliveredAt: null,
        lastErrorCategory: null,
      })
      .execute();
    return {
      workflowId,
      tripId: booking.tripId,
      ownerUserId: userId,
      tripVersion: trip.currentVersion,
      bookingId,
      componentId,
      requestedChange: input.requestedChange,
      status: "accepted" as const,
    };
  });
  try {
    await startWorkflow(
      "revalidateComponentReschedule",
      revalidation.workflowId,
      process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking",
      revalidation,
    );
  } catch {
    /* The accepted request remains durable for worker reconciliation. */
  }
  return { workflowId: revalidation.workflowId, status: revalidation.status };
}
