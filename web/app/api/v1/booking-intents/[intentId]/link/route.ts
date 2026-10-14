import { apiResponse, assertSameOrigin, planningContext, requestJson } from "@/server/api";
import { linkTrip } from "@/server/auth/link-trip";
export async function POST(request: Request, route: { params: Promise<{ intentId: string }> }) {
  return apiResponse(request, async (application) => {
    assertSameOrigin(application, request);
    return linkTrip(application.database, (await planningContext(application, request)).identity,
      (await route.params).intentId, await requestJson(request));
  });
}
