import { bookingApiResponse, browserUser, requestJson } from "@/server/api";
import { rescheduleBookingComponent } from "@/server/booking/routes";

export async function POST(
  request: Request,
  context: { params: Promise<{ bookingId: string; componentId: string }> },
): Promise<Response> {
  return bookingApiResponse(
    request,
    async (application) => {
      const user = await browserUser(application, request),
        { bookingId, componentId } = await context.params;
      return rescheduleBookingComponent(
        application.database,
        user.id,
        bookingId,
        componentId,
        await requestJson(request),
      );
    },
    { status: 202 },
  );
}
