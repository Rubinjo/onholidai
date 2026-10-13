import { CreateAgentRunRequestSchema } from "@contracts/agent-api/generated.zod";
import { apiResponse, internalActor, requestJson } from "@/server/api";
import { RunRepository } from "@/server/agent-client/run-repository";
export async function POST(request: Request, route: { params: Promise<{ runId: string }> }) {
  return apiResponse(request, async (application) => {
    const input = CreateAgentRunRequestSchema.parse(await requestJson(request));
    const actor = internalActor(application, request, input.actor.tripId, input.actor.baseTripVersion, "run:write");
    return new RunRepository(application.database).validateDispatch(actor, (await route.params).runId, input);
  });
}
