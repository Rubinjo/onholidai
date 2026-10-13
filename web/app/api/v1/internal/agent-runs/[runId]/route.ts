import { z } from "zod";
import { apiResponse, internalActor } from "@/server/api";
import { RunRepository, runConflict } from "@/server/agent-client/run-repository";
export async function GET(request: Request, route: { params: Promise<{ runId: string }> }) {
  return apiResponse(request, async (application) => {
    const actor = internalActor(application, request, z.uuid().parse(request.headers.get("x-trip-id")),
      z.coerce.number().int().positive().parse(request.headers.get("x-base-trip-version")), "run:write");
    const run = await new RunRepository(application.database).readScoped(actor, (await route.params).runId);
    if (actor.requestId !== run.requestId) runConflict();
    const { ownerUserId: _owner, ...envelope } = run; void _owner;
    return envelope;
  });
}
