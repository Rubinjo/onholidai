import { rejectProposal } from "@/domain/trip/accept-proposal";
import { apiResponse, browserUser, requestJson } from "@/server/api";
export async function POST(request: Request, route: { params: Promise<{ tripId: string; proposalId: string }> }) {
  return apiResponse(request, async (application) => {
    const { tripId, proposalId } = await route.params;
    return rejectProposal(application.database, (await browserUser(application, request)).id, tripId, proposalId, await requestJson(request));
  });
}
