import { acceptEstimate } from "@/domain/trip/apply-estimate";
import { apiResponse, browserUser, requestJson } from "@/server/api";
export async function POST(request: Request, route: { params: Promise<{ tripId: string; proposalId: string }> }) {
  return apiResponse(request, async (application) => {
    const { tripId, proposalId } = await route.params;
    return acceptEstimate(application.database, (await browserUser(application, request)).id, tripId, proposalId, await requestJson(request));
  });
}
