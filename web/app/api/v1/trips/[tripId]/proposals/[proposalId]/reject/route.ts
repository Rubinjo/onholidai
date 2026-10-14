import { rejectProposal } from "@/domain/trip/accept-proposal";
import { planningApiResponse, planningUser, requestJson } from "@/server/api";
export async function POST(request: Request, route: { params: Promise<{ tripId: string; proposalId: string }> }) {
  return planningApiResponse(request, async (application) => {
    const { tripId, proposalId } = await route.params;
    return rejectProposal(application.database, (await planningUser(application, request)).id, tripId, proposalId, await requestJson(request));
  });
}
