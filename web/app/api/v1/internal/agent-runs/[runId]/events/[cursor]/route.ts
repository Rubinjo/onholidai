import { z } from "zod";

import { PersistAgentEventRequestSchema } from "@contracts/agent-api/generated.zod";
import { internalPlanningApiResponse, internalActor, requestJson } from "@/server/api";
import { RunRepository } from "@/server/agent-client/run-repository";
import { recordEstimate } from "@/domain/trip/apply-estimate";
import { recordRefinement } from "@/domain/trip/refinement";

export async function PUT(
  request: Request,
  route: { params: Promise<{ runId: string; cursor: string }> },
) {
  return internalPlanningApiResponse(request, async (application) => {
    const input = PersistAgentEventRequestSchema.parse(await requestJson(request)),
      { runId, cursor } = await route.params;
    const actor = internalActor(
      application,
      request,
      input.tripId,
      input.baseTripVersion,
      "run:write",
    );
    const receipt = await new RunRepository(application.database).event(
      actor,
      runId,
      z.coerce.number().int().positive().parse(cursor),
      input,
    );
    if (input.event.type === "proposal") {
      // Refinements need web-owned repricing, so the reviewed impact exists before acceptance.
      await (["refinement", "finalization"].includes(input.event.proposal.purpose)
        ? recordRefinement(
            application.database,
            actor,
            runId,
            input.event.proposal,
            application.planningProviders,
          )
        : recordEstimate(application.database, actor, runId, input.event.proposal));
    }
    return receipt;
  });
}
