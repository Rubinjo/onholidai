import { ChangeProposalSchema } from "@contracts/agent-api/generated.zod";
import { apiResponse, internalActor, requestJson } from "@/server/api";
import { recordEstimate } from "@/domain/trip/apply-estimate";
import { recordRefinement } from "@/domain/trip/refinement";
import { runConflict } from "@/server/agent-client/run-repository";

export async function POST(request: Request, context: { params: Promise<{ tripId: string }> }): Promise<Response> {
  return apiResponse(request, async (application) => {
    const tripId = (await context.params).tripId;
    const proposal = ChangeProposalSchema.parse(await requestJson(request));
    const actor = internalActor(application, request, tripId, proposal.baseTripVersion, "proposal:create");
    const run = await application.database.selectFrom("agentRuns").select("id").where("tripId", "=", tripId)
      .where("ownerUserId", "=", actor.userId).where("requestId", "=", actor.requestId).executeTakeFirst();
    if (!run) runConflict();
    return ["refinement", "finalization"].includes(proposal.purpose) ? recordRefinement(application.database, actor, run.id, proposal, application.planningProviders)
      : recordEstimate(application.database, actor, run.id, proposal);
  }, { status: 201 });
}
