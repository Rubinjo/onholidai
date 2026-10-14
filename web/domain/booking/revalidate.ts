import type { BookingActor } from "@/server/auth/planning-actor";
import { bookingActor, lockBookingTrip } from "@/server/auth/booking-access";
import { createHash, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "@/server/db/database";
import { ProblemError } from "@/server/errors";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { startWorkflow } from "@/server/workflows/client";
import { inTransaction } from "@/server/db/transaction";

const requestSchema = z.object({ requestId: z.uuid(), expectedVersion: z.number().int().positive() }).strict();

export async function startBookingRevalidation(database: Kysely<Database>, proof: string | BookingActor, tripId: string, raw: unknown) {
  const input = requestSchema.parse(raw);
  const actor = await bookingActor(database, proof, tripId), userId = actor.accountUserId;
  const requestFingerprint = createHash("sha256").update(JSON.stringify({ userId, tripId, requestId: input.requestId, expectedVersion: input.expectedVersion })).digest("hex");
  const workflowId = randomUUID();
  const record = await inTransaction(database, async (transaction) => {
    const trip = await lockBookingTrip(transaction, actor, tripId);
    if (!trip) throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
    if (trip.currentVersion !== input.expectedVersion || !["finalized", "partially_booked", "booked"].includes(trip.lifecycleState)) {
      throw new ProblemError({ title: "Trip state changed before live revalidation", status: 409, code: "booking_trip_not_available" });
    }
    const prior = await transaction.selectFrom("bookingRevalidations").selectAll()
      .where("tripId", "=", tripId).where("requestId", "=", input.requestId).forUpdate().executeTakeFirst();
    if (prior) {
      if (prior.requestFingerprint !== requestFingerprint) throw new ProblemError({ title: "Request ID was reused with different booking terms", status: 409, code: "idempotency_conflict" });
      return prior;
    }
    const snapshot = tripSnapshotSchema.parse((await readOwnedTripVersion(transaction, actor.planningOwnerId, tripId)).snapshot);
    if (!snapshot.components.length) throw new ProblemError({ title: "No bookable components", status: 409, code: "booking_components_missing" });
    await transaction.insertInto("bookingRevalidations").values({ workflowId, tripId, ownerUserId: userId,
      requestId: input.requestId, requestFingerprint, tripVersion: input.expectedVersion, status: "accepted", outcomes: sql<unknown[]>`${JSON.stringify([])}::jsonb`,
      terms: null, termsHash: null, expiresAt: null, createdAt: new Date(), updatedAt: new Date() }).execute();
    await transaction.insertInto("outboxEvents").values({ id: randomUUID(), eventType: "booking.revalidation.requested",
      eventVersion: 1, aggregateType: "trip", aggregateId: tripId, aggregateVersion: input.expectedVersion,
      payload: { workflowId, tripId, ownerUserId: userId, tripVersion: input.expectedVersion },
      leaseExpiresAt: null, deliveredAt: null, lastErrorCategory: null }).execute();
    return { workflowId, tripId, ownerUserId: userId, tripVersion: input.expectedVersion, status: "accepted" as const };
  });
  // Revalidation is durable before Temporal is contacted. A retry uses the same workflow id.
  try {
    await startWorkflow("revalidateBooking", record.workflowId, process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking", {
      workflowId: record.workflowId, tripId, ownerUserId: userId, tripVersion: input.expectedVersion,
    });
  } catch {
    // The durable accepted record and outbox event let the worker dispatcher recover startup failures.
  }
  return { workflowId: record.workflowId, status: record.status };
}
