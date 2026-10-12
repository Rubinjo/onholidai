import { changeProposalSchema } from "@/domain/trip/proposal";
import { apiResponse, internalActor, requestJson } from "@/server/api";
import { ProposalRepository } from "@/server/db/proposal-repository";

export async function POST(request: Request, context: { params: Promise<{ tripId: string }> }): Promise<Response> {
  return apiResponse(request, async (application) => {
    const tripId = (await context.params).tripId;
    const proposal = changeProposalSchema.parse(await requestJson(request));
    const actor = internalActor(application, request, tripId, proposal.baseTripVersion, "proposal:create");
    return new ProposalRepository(application.database).record(actor, proposal);
  }, { status: 201 });
}
