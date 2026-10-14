import type { BookingActor } from "@/server/auth/planning-actor";
import { bookingActor, lockBookingTrip } from "@/server/auth/booking-access";
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import { bookingTermsSchema, type BookingAuthorization } from "@/domain/booking/authorization";
import { bookingTransactionSchema, projectBookingTransactionRow, type BookingTransaction } from "@/domain/booking/schema";
import type { Database } from "@/server/db/database";
import { inTransaction } from "@/server/db/transaction";
import { BookingRepository } from "@/server/db/booking-repository";
import { ProblemError } from "@/server/errors";
import { startWorkflow } from "@/server/workflows/client";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { tripSnapshotSchema } from "@/domain/trip/schema";

const startSchema = z.object({ requestId: z.uuid(), authorizationId: z.uuid() }).strict();

export async function startBooking(database: Kysely<Database>, proof: string | BookingActor, tripId: string, raw: unknown): Promise<BookingTransaction> {
  const input = startSchema.parse(raw);
  const actor = await bookingActor(database, proof, tripId), userId = actor.accountUserId;
  const result = await inTransaction(database, async (transaction) => {
    const trip = await lockBookingTrip(transaction, actor, tripId);
    if (!trip) throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
    const existing = await transaction.selectFrom("bookingTransactions").selectAll()
      .where("authorizationId", "=", input.authorizationId).where("ownerUserId", "=", userId).executeTakeFirst();
    if (existing) return projectBookingTransactionRow(existing);
    const row = await new BookingRepository(transaction).getAuthorizationForUpdate(input.authorizationId, tripId, userId);
    if (!row) throw new ProblemError({ title: "Booking authorization not found", status: 404, code: "booking_authorization_not_found" });
    const authorization: BookingAuthorization = {
      id: row.id, tripId: row.tripId, userId: row.ownerUserId, tripVersion: row.tripVersion,
      operation: row.operation, componentId: row.componentId, terms: bookingTermsSchema.parse(row.terms),
      termsHash: row.termsHash, acknowledgedNonReversibleActions: row.acknowledgedNonReversibleActions,
      status: row.status, reason: row.reason, authorizedAt: row.authorizedAt.toISOString(), expiresAt: row.expiresAt.toISOString(),
    };
    const now = new Date();
    if (trip.currentVersion !== authorization.tripVersion || !["finalized", "partially_booked", "booked"].includes(trip.lifecycleState)
      || authorization.status !== "authorized" || Date.parse(authorization.expiresAt) <= now.getTime()) {
      throw new ProblemError({ title: "Booking authorization is stale or expired", status: 409, code: "booking_authorization_stale" });
    }
    const transactionId = randomUUID();
    const workflowId = `booking-${transactionId}`;
    const currentVersion = await readOwnedTripVersion(transaction, actor.planningOwnerId, tripId);
    const currentSnapshot = tripSnapshotSchema.parse(currentVersion.snapshot);
    const authorizedComponents = authorization.operation === "book_trip"
      ? authorization.terms.components.filter((term) => currentSnapshot.components.some((component) =>
        component.id === term.componentId && component.bookingStatus === "unbooked"))
      : authorization.terms.components.filter((component) => component.componentId === authorization.componentId);
    if (authorization.operation === "book_trip" && authorizedComponents.length === 0) {
      throw new ProblemError({ title: "No unbooked components remain", status: 409, code: "booking_components_already_confirmed" });
    }
    if (authorizedComponents.length === 0) throw new ProblemError({ title: "Authorized component is missing", status: 409, code: "booking_component_mismatch" });
    const components = authorizedComponents.map((component) => ({
      componentId: component.componentId, status: "authorized" as const, providerReference: null, safeReason: null,
    }));
    const booking = bookingTransactionSchema.parse({
      id: transactionId, tripId, authorizationId: authorization.id, operation: authorization.operation,
      status: "requested", components, startedAt: now.toISOString(), completedAt: null,
      executionBasis: { ownerUserId: userId, operation: authorization.operation, authorizationId: authorization.id,
        startingTripVersion: authorization.tripVersion, terms: authorization.terms,
        termsHash: authorization.termsHash, expiresAt: authorization.expiresAt },
      lastObservedTripVersion: authorization.tripVersion, executionStatus: "active", workflowId, requestId: input.requestId,
    });
    const claimed = await new BookingRepository(transaction).startTransaction({ transaction: booking, ownerUserId: userId });
    if (!claimed) throw new ProblemError({ title: "Booking authorization was already consumed or expired", status: 409, code: "booking_authorization_consumed" });
    await transaction.insertInto("outboxEvents").values({ id: randomUUID(), eventType: "booking.transaction.requested",
      eventVersion: 1, aggregateType: "trip", aggregateId: tripId, aggregateVersion: trip.currentVersion,
      payload: { transactionId, workflowId, operation: authorization.operation }, leaseExpiresAt: null,
      deliveredAt: null, lastErrorCategory: null }).execute();
    return booking;
  });
  try {
    await startWorkflow("bookTrip", result.workflowId, process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking", { transactionId: result.id });
  } catch {
    // Transaction and outbox are durable; dispatcher reconciliation can start it later.
  }
  return result;
}
