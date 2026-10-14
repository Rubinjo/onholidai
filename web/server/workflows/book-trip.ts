import { proxyActivities } from "@temporalio/workflow";
import type { BookingWorkflowActivities } from "./booking-contract";

const activities = proxyActivities<Omit<BookingWorkflowActivities, "revalidateBooking">>({
  startToCloseTimeout: "20 seconds", retry: { maximumAttempts: 1 },
});

export async function bookTrip(input: { transactionId: string }): Promise<{ transactionId: string; status: string }> {
  const transaction = await activities.loadBookingTransaction(input.transactionId);
  const outcomes: string[] = [];
  for (const component of transaction.components) {
    if (component.status === "confirmed" || component.status === "cancelled") continue;
    try {
      await activities.assertExecutionBasis(transaction.id, component.componentId);
      const claim = await activities.claimProviderWrite(transaction.id, component.componentId);
      if (!claim.allowed) {
        outcomes.push("action_required");
        await activities.recordBookingOutcome(transaction.id, { ...component, status: "action_required", safeReason: "A pending provider action must be reconciled before continuing." });
        break;
      }
      const result = await activities.executeProviderWrite(transaction.id, component.componentId, claim.idempotencyKey, claim.requestFingerprint);
      await activities.recordBookingOutcome(transaction.id, result);
      outcomes.push(result.status);
      if (result.status === "unknown" || result.status === "action_required") break;
    } catch {
      const safe: typeof component = { ...component, status: "action_required", safeReason: "Booking stopped because its authorization or execution basis changed." };
      await activities.recordBookingOutcome(transaction.id, safe);
      outcomes.push(safe.status);
      break;
    }
  }
  const status = outcomes.includes("unknown") || outcomes.includes("action_required") ? "action_required"
    : outcomes.includes("confirmed") ? "partially_confirmed" : outcomes.every((value) => value === "failed") ? "failed" : "confirmed";
  return { transactionId: transaction.id, status };
}
