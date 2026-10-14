import { apiResponse, browserUser, requestJson } from "@/server/api";
import { startComponentRescheduleRevalidation } from "@/domain/booking/reschedule";

export async function POST(request: Request, context: { params: Promise<{ bookingId: string; componentId: string }> }): Promise<Response> {
  return apiResponse(request, async (application) => {
    const user = await browserUser(application, request), { bookingId, componentId } = await context.params;
    return startComponentRescheduleRevalidation(application.database, user.id, bookingId, componentId, await requestJson(request));
  }, { status: 202 });
}
