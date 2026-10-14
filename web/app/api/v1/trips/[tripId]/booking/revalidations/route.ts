import { apiResponse, browserUser, requestJson } from "@/server/api";
import { startBookingRevalidation } from "@/domain/booking/revalidate";

type Route = { params: Promise<{ tripId: string }> };
export async function POST(request: Request, route: Route): Promise<Response> {
  return apiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    return startBookingRevalidation(application.database, user.id, (await route.params).tripId, await requestJson(request));
  }, { status: 202 });
}
