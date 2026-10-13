import { z } from "zod";
import { PersistAgentEventRequestSchema } from "@contracts/agent-api/generated.zod";
import { apiResponse, internalActor, requestJson } from "@/server/api";
import { RunRepository } from "@/server/agent-client/run-repository";
import { recordEstimate } from "@/domain/trip/apply-estimate";
export async function PUT(request: Request, route: { params: Promise<{ runId: string; cursor: string }> }) {
  return apiResponse(request, async (application) => {
    const input = PersistAgentEventRequestSchema.parse(await requestJson(request)), { runId, cursor } = await route.params;
    const actor = internalActor(application, request, input.tripId, input.baseTripVersion, "run:write");
    const receipt = await new RunRepository(application.database).event(actor, runId, z.coerce.number().int().positive().parse(cursor), input);
    if (input.event.type === "proposal") await recordEstimate(application.database, actor, runId, input.event.proposal);
    return receipt;
  });
}
