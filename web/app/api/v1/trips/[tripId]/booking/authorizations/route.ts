import { bookingApiResponse, browserUser, requestJson } from "@/server/api";
import { authorizeBooking } from "@/domain/booking/authorize";

type Route = { params: Promise<{ tripId: string }> };
export async function POST(request: Request, route: Route): Promise<Response> {
  return bookingApiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    return authorizeBooking(application.database, user.id, (await route.params).tripId, await requestJson(request));
  }, { status: 201 });
}
