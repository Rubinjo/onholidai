import { createHash } from "node:crypto";

import { sql, type Kysely } from "kysely";

import { lockBookingEvidenceTrip } from "@/server/auth/booking-access";
import { ProblemError } from "@/server/errors";
import { commitTripMutation } from "@/domain/trip/commit";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { projectBookingTransactionRow, type BookingComponentState } from "@/domain/booking/schema";
import { canonicalBookingJson } from "@/domain/booking/authorization";
import { inTransaction } from "@/server/db/transaction";

import type { Database } from "@/server/db/database";

function stableUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function tripStatus(
  status: BookingComponentState["status"],
): "pending" | "confirmed" | "cancelled" | "unknown" | "action_required" {
  if (
    status === "confirmed" ||
    status === "cancelled" ||
    status === "unknown" ||
    status === "action_required"
  )
    return status;
  return "pending";
}

export async function applyBookingOutcome(
  database: Kysely<Database>,
  transactionId: string,
  outcome: BookingComponentState,
  now = new Date(),
) {
  return inTransaction(database, async (transaction) => {
    const bookingRow = await transaction
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", transactionId)
      .executeTakeFirst();
    if (!bookingRow)
      throw new ProblemError({
        title: "Booking transaction not found",
        status: 404,
        code: "booking_not_found",
      });
    const { trip, principal } = await lockBookingEvidenceTrip(transaction, bookingRow.tripId);
    const lockedBookingRow = await transaction
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", transactionId)
      .forUpdate()
      .executeTakeFirst();
    if (!trip || !lockedBookingRow)
      throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
    const booking = projectBookingTransactionRow(lockedBookingRow);
    const previous = booking.components.find((item) => item.componentId === outcome.componentId);
    if (!previous)
      throw new ProblemError({
        title: "Booking component not found",
        status: 404,
        code: "booking_component_not_found",
      });
    if (previous.providerReference && outcome.providerReference !== previous.providerReference) {
      outcome = {
        ...outcome,
        status: "action_required",
        providerReference: previous.providerReference,
        safeReason:
          "Contradictory provider evidence requires support. The prior reference is preserved.",
      };
    }
    const updatedComponents = booking.components.map((item) =>
      item.componentId === outcome.componentId ? outcome : item,
    );
    const unresolved = updatedComponents.some((item) =>
      ["unknown", "action_required"].includes(item.status),
    );
    const confirmedCount = updatedComponents.filter((item) => item.status === "confirmed").length;
    const complete = updatedComponents.every((item) =>
      ["confirmed", "failed", "cancelled"].includes(item.status),
    );
    async function saveState(version: number, projectionConflict: boolean) {
      await transaction
        .updateTable("bookingTransactions")
        .set({
          components: sql<unknown[]>`${JSON.stringify(updatedComponents)}::jsonb`,
          lastObservedTripVersion: version,
          status:
            unresolved || projectionConflict
              ? "action_required"
              : complete && updatedComponents.every((item) => item.status === "confirmed")
                ? "confirmed"
                : complete && updatedComponents.every((item) => item.status === "cancelled")
                  ? "cancelled"
                  : complete && confirmedCount === 0
                    ? "failed"
                    : confirmedCount > 0
                      ? "partially_confirmed"
                      : "running",
          executionStatus:
            unresolved || projectionConflict
              ? booking.executionStatus === "expired"
                ? "expired"
                : "invalidated"
              : complete && booking.executionStatus === "active"
                ? "completed"
                : booking.executionStatus,
          completedAt: complete ? now : null,
        })
        .where("id", "=", transactionId)
        .execute();
    }
    const competingClaim = await transaction
      .selectFrom("bookingWriteClaims")
      .select("attemptId")
      .where("tripId", "=", booking.tripId)
      .where("transactionId", "!=", booking.id)
      .executeTakeFirst();
    const projectionConflict =
      Boolean(competingClaim) ||
      trip.currentVersion !== booking.lastObservedTripVersion ||
      principal.accountUserId !== booking.executionBasis.ownerUserId;
    if (projectionConflict || canonicalBookingJson(previous) === canonicalBookingJson(outcome)) {
      await saveState(booking.lastObservedTripVersion, projectionConflict);
      return {
        tripId: booking.tripId,
        version: trip.currentVersion,
        componentId: outcome.componentId,
        status: outcome.status,
      };
    }
    const current = await readOwnedTripVersion(transaction, principal.id, booking.tripId);
    const snapshot = tripSnapshotSchema.parse(current.snapshot);
    const component = snapshot.components.find((item) => item.id === outcome.componentId);
    if (!component) {
      await saveState(booking.lastObservedTripVersion, true);
      return {
        tripId: booking.tripId,
        version: trip.currentVersion,
        componentId: outcome.componentId,
        status: outcome.status,
      };
    }
    let stoppedBeforeDispatch = false;
    if (
      booking.operation === "book_trip" &&
      outcome.status === "action_required" &&
      !outcome.providerReference
    ) {
      const [dispatched, confirmation] = await Promise.all([
        transaction
          .selectFrom("bookingComponentAttempts")
          .select("id")
          .where("transactionId", "=", transactionId)
          .where("componentId", "=", outcome.componentId)
          .where("status", "!=", "claimed")
          .executeTakeFirst(),
        transaction
          .selectFrom("bookingConfirmations")
          .select("id")
          .where("tripId", "=", booking.tripId)
          .where("componentId", "=", outcome.componentId)
          .executeTakeFirst(),
      ]);
      stoppedBeforeDispatch = !dispatched && !confirmation;
    }
    // Attempt history retains the failure/local stop; neither is a pending supplier commitment.
    component.bookingStatus =
      (booking.operation === "book_trip" && outcome.status === "failed") || stoppedBeforeDispatch
        ? "unbooked"
        : tripStatus(outcome.status);
    const confirmedTerms = booking.executionBasis.terms.components.find(
      (item) => item.componentId === outcome.componentId,
    );
    if (outcome.status === "confirmed" && confirmedTerms) {
      component.serviceStart = confirmedTerms.serviceStart;
      component.serviceEnd = confirmedTerms.serviceEnd;
      component.travellerIds = confirmedTerms.travellerIds;
      component.supplierOfferId = confirmedTerms.supplierOfferId;
      component.cancellationTerms = confirmedTerms.cancellationTerms;
      component.checkedAt = now.toISOString();
      component.expiresAt = null;
    }
    const tripComponentStatuses = snapshot.components.map((item) => item.bookingStatus);
    const confirmedCountForTrip = tripComponentStatuses.filter(
      (status) => status === "confirmed",
    ).length;
    const allConfirmedForTrip =
      tripComponentStatuses.length > 0 && confirmedCountForTrip === tripComponentStatuses.length;
    const lifecycleState = allConfirmedForTrip
      ? "booked"
      : confirmedCountForTrip > 0
        ? "partially_booked"
        : tripComponentStatuses.length > 0 &&
            tripComponentStatuses.every((status) => status === "cancelled")
          ? "cancelled"
          : undefined;
    const requestId = stableUuid(`${transactionId}:${outcome.componentId}:${outcome.status}`);
    const fingerprint = createHash("sha256")
      .update(
        canonicalBookingJson({
          transactionId,
          outcome,
          tripVersion: trip.currentVersion,
          termsHash: booking.executionBasis.termsHash,
        }),
      )
      .digest("hex");
    const receipt = await commitTripMutation(transaction, {
      tripId: booking.tripId,
      ownerUserId: principal.id,
      expectedVersion: trip.currentVersion,
      ...(lifecycleState ? { lifecycleState } : {}),
      requestId,
      idempotencyKey: `booking-outcome:${transactionId}:${outcome.componentId}:${outcome.status}`,
      requestFingerprint: fingerprint,
      snapshot,
      initiatingActor: "booking_workflow",
      proposalId: null,
      traceId: transactionId,
      changeSummary: [`booking_${outcome.status}`, `component:${outcome.componentId}`],
      inverseOperation: null,
      nonReversibleReason:
        outcome.status === "confirmed"
          ? "A provider-confirmed booking cannot be undone as a draft change."
          : "Booking workflow evidence is append-only.",
      outboxEventId: stableUuid(`${requestId}:outbox`),
      auditEventId: stableUuid(`${requestId}:audit`),
    });
    await transaction
      .insertInto("bookingVersionEvidence")
      .values({
        tripId: booking.tripId,
        tripVersion: receipt.version,
        transactionId,
        materialTermsHash: booking.executionBasis.termsHash,
        createdAt: now,
      })
      .onConflict((conflict) => conflict.columns(["tripId", "tripVersion"]).doNothing())
      .execute();
    await saveState(receipt.version, false);
    return {
      tripId: booking.tripId,
      version: receipt.version,
      componentId: outcome.componentId,
      status: outcome.status,
    };
  });
}
