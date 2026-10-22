import { proxyActivities } from "@temporalio/workflow";

import type {
  BookingWorkflowActivities,
  RevalidationWorkflowInput,
  RevalidationWorkflowResult,
} from "./booking-contract";

const activities = proxyActivities<Pick<BookingWorkflowActivities, "revalidateBooking">>({
  startToCloseTimeout: "8 seconds",
  retry: { maximumAttempts: 1 },
});

export async function revalidateBooking(
  input: RevalidationWorkflowInput,
): Promise<RevalidationWorkflowResult> {
  return activities.revalidateBooking(input);
}
