import { proxyActivities } from "@temporalio/workflow";

import type { BookingWorkflowActivities } from "./booking-contract";

const activities = proxyActivities<
  Pick<BookingWorkflowActivities, "reconcileProviderStatus" | "recordBookingOutcome">
>({
  startToCloseTimeout: "20 seconds",
  retry: { maximumAttempts: 1 },
});

export async function reconcileBookingComponent(input: {
  transactionId: string;
  componentId: string;
}) {
  const outcome = await activities.reconcileProviderStatus(input.transactionId, input.componentId);
  await activities.recordBookingOutcome(input.transactionId, outcome);
  return outcome;
}
