import { apiResponse, browserUser, requestJson } from "@/server/api";
import { finalizeTrip, reviewFinalization } from "@/domain/trip/finalize";
type Route = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, route: Route) {
  return apiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    return reviewFinalization(application.database, user.id, (await route.params).tripId);
  });
}
export async function POST(request: Request, route: Route) {
  return apiResponse(request, async (application) => {
    const user = await browserUser(application, request);
    return finalizeTrip(application.database, user.id, (await route.params).tripId, await requestJson(request));
  });
}
