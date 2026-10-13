import type { AgentRun, CreateAgentRunRequest } from "../../../contracts/agent-api/generated";
import { AgentRunSchema, CreateAgentRunRequestSchema } from "../../../contracts/agent-api/generated.zod";
import { readAgentTrip } from "@/domain/trip/read";
import type { Application } from "@/server/application";
import { ProblemError } from "@/server/errors";
import { createServiceToken } from "./credentials";
import { runContext } from "./run-repository";

export async function dispatchEstimate(application: Application, run: AgentRun & { ownerUserId: string }, message: string,
  transport: typeof fetch = fetch): Promise<void> {
  if (run.status !== "queued") return;
  const context = runContext(run);
  const trip = await readAgentTrip(application.database, run.ownerUserId, run.tripId, run.baseTripVersion, "compact");
  const body: CreateAgentRunRequest = CreateAgentRunRequestSchema.parse({ contractVersion: "1", actor: {
    userId: context.userId, tripId: run.tripId, baseTripVersion: run.baseTripVersion, scopes: ["trip:read", "proposal:create"] },
    requestId: run.requestId, conversationId: run.conversationId, purpose: run.purpose, message,
    // The agent fetches the authoritative bounded view through get_trip; do not
    // duplicate a potentially large snapshot in the creation command.
    context: { tripSummary: { tripId: trip.tripId, version: trip.version }, contextBudget: { maximumTokens: 24000 } } });
  const token = createServiceToken({ ...context, secret: application.config.SERVICE_TOKEN_SECRET,
    audience: "agent", scopes: ["trip:read", "proposal:create"] });
  const response = await transport(new URL("/internal/v1/agent-runs", application.config.AGENT_BASE_URL), { method: "POST",
    headers: { "Content-Type": "application/json", authorization: `Bearer ${token}`, "x-agent-run-id": run.id },
    body: JSON.stringify(body), signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!response.ok) throw new ProblemError({ title: "Research service unavailable", status: 503, code: "agent_unavailable" });
  const acknowledged = AgentRunSchema.parse(await response.json());
  if (acknowledged.id !== run.id || acknowledged.requestId !== run.requestId || acknowledged.baseTripVersion !== run.baseTripVersion)
    throw new ProblemError({ title: "Invalid research acknowledgement", status: 502, code: "invalid_agent_response" });
}
