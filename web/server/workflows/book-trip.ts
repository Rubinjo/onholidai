import { proxyActivities } from "@temporalio/workflow";
import type { BookingWorkflowActivities } from "./booking-contract";

const activities = proxyActivities<Omit<BookingWorkflowActivities, "revalidateBooking">>({
  startToCloseTimeout: "20 seconds", retry: { maximumAttempts: 1 },
});

// Durable transaction states that must not start another provider action.
const settledTransactionStatuses = new Set(["confirmed", "partially_confirmed", "action_required", "failed", "cancelled"]);
// Component states that still need a single provider action in this run.
const actionableComponentStatuses = new Set(["authorized", "booking", "proposed", "pending"]);

export async function bookTrip(input: { transactionId: string }): Promise<{ transactionId: string; status: string }> {
  const transaction = await activities.loadBookingTransaction(input.transactionId);
  if (!settledTransactionStatuses.has(transaction.status) && transaction.executionStatus === "active") {
    for (const component of transaction.components) {
      if (!actionableComponentStatuses.has(component.status)) continue;
      try {
        await activities.assertExecutionBasis(transaction.id, component.componentId);
        const claim = await activities.claimProviderWrite(transaction.id, component.componentId);
        if (!claim.allowed) {
          await activities.recordBookingOutcome(transaction.id, { ...component, status: "action_required", safeReason: "A pending provider action must be reconciled before continuing." });
          break;
        }
        const result = await activities.executeProviderWrite(transaction.id, component.componentId, claim.idempotencyKey, claim.requestFingerprint);
        await activities.recordBookingOutcome(transaction.id, result);
        if (result.status === "unknown" || result.status === "action_required") break;
      } catch {
        const safe: typeof component = { ...component, status: "action_required", safeReason: "Booking stopped because its authorization or execution basis changed." };
        await activities.recordBookingOutcome(transaction.id, safe);
        break;
      }
    }
  }
  // Replay reads the durable outcome instead of the local loop, so a restarted
  // workflow never repeats a write or treats consumed authorization as permission
  // for changed terms.
  const finalTransaction = await activities.loadBookingTransaction(input.transactionId);
  const statuses = finalTransaction.components.map((component) => component.status);
  const status = finalTransaction.status === "action_required"
    || finalTransaction.executionStatus === "invalidated" || finalTransaction.executionStatus === "expired" ? "action_required"
    : statuses.every((value) => value === "confirmed") ? "confirmed"
      : statuses.some((value) => value === "unknown" || value === "action_required") ? "action_required"
        : statuses.some((value) => value === "confirmed") ? "partially_confirmed"
          : statuses.every((value) => value === "cancelled") ? "cancelled" : "failed";
  return { transactionId: transaction.id, status };
}
