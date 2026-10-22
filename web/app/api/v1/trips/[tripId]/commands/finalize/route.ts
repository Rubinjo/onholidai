import { planningApiResponse, planningUser, requestJson } from "@/server/api";
import { finalizeTrip, reviewFinalization } from "@/domain/trip/finalize";

type Route = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, route: Route) {
  return planningApiResponse(request, async (application) => {
    const user = await planningUser(application, request);
    return reviewFinalization(application.database, user.id, (await route.params).tripId);
  });
}
export async function POST(request: Request, route: Route) {
  return planningApiResponse(request, async (application) => {
    const user = await planningUser(application, request);
    return finalizeTrip(
      application.database,
      user.id,
      (await route.params).tripId,
      await requestJson(request),
    );
  });
}
