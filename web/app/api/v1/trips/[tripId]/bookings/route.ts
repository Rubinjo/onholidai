import { bookingApiResponse, browserUser, requestJson } from "@/server/api";
import { startBooking } from "@/domain/booking/start";

type Route = { params: Promise<{ tripId: string }> };
export async function POST(request: Request, route: Route): Promise<Response> {
  return bookingApiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    return startBooking(application.database, user.id, (await route.params).tripId, await requestJson(request));
  }, { status: 202 });
}
