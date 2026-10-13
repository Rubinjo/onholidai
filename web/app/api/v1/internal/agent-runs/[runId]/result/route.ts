import { PersistAgentResultRequestSchema } from "@contracts/agent-api/generated.zod";
import { apiResponse, internalActor, requestJson } from "@/server/api";
import { RunRepository } from "@/server/agent-client/run-repository";
export async function PUT(request: Request, route: { params: Promise<{ runId: string }> }) {
  return apiResponse(request, async (application) => {
    const input = PersistAgentResultRequestSchema.parse(await requestJson(request));
    const actor = internalActor(application, request, input.tripId, input.baseTripVersion, "run:write");
    return new RunRepository(application.database).result(actor, (await route.params).runId, input);
  });
}
