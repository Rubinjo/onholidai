import { proxyActivities } from "@temporalio/workflow";

import type {
  BookingWorkflowActivities,
  ComponentRescheduleWorkflowInput,
  RevalidationWorkflowResult,
} from "./booking-contract";

const activities = proxyActivities<
  Pick<BookingWorkflowActivities, "revalidateComponentReschedule">
>({
  startToCloseTimeout: "8 seconds",
  retry: { maximumAttempts: 1 },
});

export async function revalidateComponentReschedule(
  input: ComponentRescheduleWorkflowInput,
): Promise<RevalidationWorkflowResult> {
  return activities.revalidateComponentReschedule(input);
}
