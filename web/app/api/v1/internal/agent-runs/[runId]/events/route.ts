import { z } from "zod";

import { internalPlanningApiResponse, internalActor } from "@/server/api";
import { RunRepository, runConflict } from "@/server/agent-client/run-repository";

export async function GET(request: Request, route: { params: Promise<{ runId: string }> }) {
  return internalPlanningApiResponse(request, async (application) => {
    const repository = new RunRepository(application.database),
      { runId } = await route.params;
    const actor = internalActor(
      application,
      request,
      z.uuid().parse(request.headers.get("x-trip-id")),
      z.coerce.number().int().positive().parse(request.headers.get("x-base-trip-version")),
      "run:write",
    );
    const userId = actor.userId,
      run = await repository.readScoped(actor, runId);
    if (actor.requestId !== run.requestId) runConflict();
    const after = z.coerce
      .number()
      .int()
      .nonnegative()
      .parse(new URL(request.url).searchParams.get("after") ?? 0);
    return repository.events(userId, runId, after);
  });
}
