import { ProblemError } from "@/server/errors";

import type { Transaction } from "kysely";
import type { Database } from "@/server/db/database";

export async function assertBookingWritesEditable(
  transaction: Transaction<Database>,
  tripId: string,
  actor: string,
  bookingTransactionId: string | null,
): Promise<void> {
  const claims = await transaction
    .selectFrom("bookingWriteClaims")
    .select(["transactionId", "state"])
    .where("tripId", "=", tripId)
    .forUpdate()
    .execute();
  const unrelated = claims.filter(
    (claim) => actor !== "booking_workflow" || claim.transactionId !== bookingTransactionId,
  );
  if (unrelated.length > 0) {
    throw new ProblemError({
      title: "A provider action is still in progress",
      status: 409,
      code: "booking_write_in_progress",
      detail: "Reconcile the affected provider action before changing these trip terms.",
    });
  }
}

export async function invalidateBookingStateForTripVersion(
  transaction: Transaction<Database>,
  tripId: string,
  bookingTransactionId: string | null,
): Promise<void> {
  await transaction
    .updateTable("bookingAuthorizations")
    .set({ status: "invalidated", reason: "trip_version_changed" })
    .where("tripId", "=", tripId)
    .where("status", "=", "authorized")
    .execute();
  if (bookingTransactionId) return;
  await transaction
    .updateTable("bookingTransactions")
    .set({ executionStatus: "invalidated", status: "action_required" })
    .where("tripId", "=", tripId)
    .where("executionStatus", "=", "active")
    .execute();
}
