import { z } from "zod";
import { apiResponse, internalActor } from "@/server/api";
import { RunRepository, runConflict } from "@/server/agent-client/run-repository";
export async function GET(request: Request, route: { params: Promise<{ runId: string; questionId: string }> }) {
  return apiResponse(request, async (application) => {
    const { runId, questionId } = await route.params;
    const actor = internalActor(application, request, z.uuid().parse(request.headers.get("x-trip-id")),
      z.coerce.number().int().positive().parse(request.headers.get("x-base-trip-version")), "run:write");
    const run = await new RunRepository(application.database).readScoped(actor, runId);
    if (actor.requestId !== run.requestId) runConflict();
    const receipt = await application.database.selectFrom("agentRunResumes").select(["fingerprint", "eventCursor"])
      .where("runId", "=", runId).where("questionId", "=", questionId).executeTakeFirst();
    if (!receipt) runConflict(); return receipt;
  });
}
