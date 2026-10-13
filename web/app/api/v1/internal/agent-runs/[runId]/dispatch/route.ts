import { apiResponse, internalActor } from "@/server/api";
import { z } from "zod";
import { RunRepository, runConflict } from "@/server/agent-client/run-repository";
export async function GET(request: Request, route: { params: Promise<{ runId: string }> }) {
  return apiResponse(request, async (application) => {
    const tripId = z.uuid().parse(request.headers.get("x-trip-id")), version = z.coerce.number().int().positive().parse(request.headers.get("x-base-trip-version"));
    const actor = internalActor(application, request, tripId, version, "run:write"), runId = (await route.params).runId;
    await new RunRepository(application.database).readScoped(actor, runId);
    const row = await application.database.selectFrom("agentRuns").select("dispatchRequest").where("id", "=", runId).executeTakeFirst();
    if (!row?.dispatchRequest) runConflict();
    return row.dispatchRequest;
  });
}
