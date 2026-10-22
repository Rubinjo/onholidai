import { z } from "zod";

import { bookingApiResponse, browserUser, requestJson } from "@/server/api";
import { ProblemError } from "@/server/errors";
import { startWorkflow } from "@/server/workflows/client";

const requestSchema = z
  .object({
    requestId: z.uuid(),
    action: z.enum(["status_check", "retry"]),
    authorizationId: z.uuid().nullable(),
  })
  .strict();
export async function POST(
  request: Request,
  context: { params: Promise<{ bookingId: string; componentId: string }> },
): Promise<Response> {
  return bookingApiResponse(
    request,
    async (application) => {
      const user = await browserUser(application, request),
        { bookingId, componentId } = await context.params;
      const input = requestSchema.parse(await requestJson(request));
      const transaction = await application.database
        .selectFrom("bookingTransactions")
        .selectAll()
        .where("id", "=", bookingId)
        .where("ownerUserId", "=", user.id)
        .executeTakeFirst();
      if (!transaction)
        throw new ProblemError({
          title: "Booking not found",
          status: 404,
          code: "booking_not_found",
        });
      if (
        !transaction.components.some(
          (entry) => (entry as { componentId?: unknown }).componentId === componentId,
        )
      ) {
        throw new ProblemError({
          title: "Booking component not found",
          status: 404,
          code: "booking_component_not_found",
        });
      }
      if (input.action !== "status_check" || input.authorizationId !== null) {
        throw new ProblemError({
          title: "A retry requires fresh exact-term authorization",
          status: 409,
          code: "booking_retry_authorization_required",
        });
      }
      const workflowId = `booking-status-${input.requestId}`;
      await startWorkflow(
        "reconcileBookingComponent",
        workflowId,
        process.env.TEMPORAL_BOOKING_TASK_QUEUE ?? "onholidai-booking",
        { transactionId: bookingId, componentId },
      );
      return { workflowId, status: "accepted" };
    },
    { status: 202 },
  );
}
