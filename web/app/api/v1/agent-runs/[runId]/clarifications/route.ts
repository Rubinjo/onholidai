import { AnswerClarificationRequestSchema } from "@contracts/agent-api/generated.zod";
import { apiResponse, browserUser, requestJson } from "@/server/api";
import { RunRepository, runContext } from "@/server/agent-client/run-repository";
import { createServiceToken } from "@/server/agent-client/credentials";
import { publicRun } from "@/server/agent-client/results";
import { ProblemError } from "@/server/errors";
export async function POST(request: Request, route: { params: Promise<{ runId: string }> }) {
  return apiResponse(request, async (application) => {
    const userId = (await browserUser(application, request)).id, { runId } = await route.params;
    const input = AnswerClarificationRequestSchema.parse(await requestJson(request));
    const { run } = await new RunRepository(application.database).resume(userId, runId, input);
    const context = runContext(run);
    const token = createServiceToken({ ...context, audience: "agent", secret: application.config.SERVICE_TOKEN_SECRET,
      scopes: ["trip:read", "proposal:create"] });
    const response = await fetch(new URL(`/internal/v1/agent-runs/${runId}/clarifications`, application.config.AGENT_BASE_URL), { method: "POST",
      headers: { "Content-Type": "application/json", authorization: `Bearer ${token}`, "x-user-id": userId,
        "x-trip-id": run.tripId, "x-request-id": run.requestId, "x-base-trip-version": String(run.baseTripVersion),
        "x-conversation-id": run.conversationId }, body: JSON.stringify(input), signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new ProblemError({ title: "Clarification service unavailable", status: 503, code: "agent_unavailable" });
    return publicRun(application.database, userId, runId);
  }, { status: 202 });
}
