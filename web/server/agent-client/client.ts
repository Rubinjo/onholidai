import { readAgentTrip } from "@/domain/trip/read";
import { ProblemError } from "@/server/errors";
import { ConversationRepository } from "@/server/db/conversation-repository";
import { lockServiceGrant } from "@/server/auth/planning-resource";
import { inTransaction } from "@/server/db/transaction";
import { selectedOffersSchema } from "@/domain/trip/proposal";

import { RunRepository, runContext } from "./run-repository";
import { createAgentServiceToken } from "./credentials";
import {
  AgentRunSchema,
  CreateAgentRunRequestSchema,
} from "../../../contracts/agent-api/generated.zod";

import type { Application } from "@/server/application";
import type { AgentRun, CreateAgentRunRequest } from "../../../contracts/agent-api/generated";

export async function dispatchEstimate(
  application: Application,
  run: AgentRun & { ownerUserId: string },
  message: string,
  transport: typeof fetch = fetch,
): Promise<void> {
  if (run.status !== "queued") return;
  const context = runContext(run);
  await inTransaction(application.database, (transaction) =>
    lockServiceGrant(transaction, context),
  );
  const trip = await readAgentTrip(
    application.database,
    run.ownerUserId,
    run.tripId,
    run.baseTripVersion,
    "compact",
  );
  const conversation =
    run.purpose === "refinement"
      ? await new ConversationRepository(application.database).context(
          run.ownerUserId,
          run.tripId,
          run.baseTripVersion,
        )
      : {};
  const requestMessage = await application.database
    .selectFrom("conversationMessages")
    .select("content")
    .where("agentRunId", "=", run.id)
    .where("role", "=", "user")
    .executeTakeFirstOrThrow();
  const selectedOffers = requestMessage.content.selectedOffers
    ? selectedOffersSchema.parse(requestMessage.content.selectedOffers)
    : undefined;
  const body: CreateAgentRunRequest = CreateAgentRunRequestSchema.parse({
    contractVersion: "1",
    actor: {
      userId: context.userId,
      tripId: run.tripId,
      baseTripVersion: run.baseTripVersion,
      scopes:
        run.purpose === "supplier_research"
          ? ["trip:read", "context:read"]
          : ["trip:read", "context:read", "proposal:create"],
    },
    requestId: run.requestId,
    conversationId: run.conversationId,
    purpose: run.purpose,
    message,
    ...(selectedOffers ? { selectedOffers } : {}),
    // The agent fetches the authoritative bounded view through get_trip; do not
    // duplicate a potentially large snapshot in the creation command.
    context: {
      tripSummary: { tripId: trip.tripId, version: trip.version },
      ...conversation,
      contextBudget: { maximumTokens: 24000 },
    },
  });
  const token = createAgentServiceToken({
    ...context,
    secret: application.config.SERVICE_TOKEN_SECRET,
    scopes:
      run.purpose === "supplier_research"
        ? ["trip:read", "context:read"]
        : ["trip:read", "context:read", "proposal:create"],
  });
  let response: Response;
  try {
    response = await transport(
      new URL("/internal/v1/agent-runs", application.config.AGENT_BASE_URL),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${token}`,
          "x-agent-run-id": run.id,
        },
        body: JSON.stringify(body),
        // Dispatch validates and persists progress through several web callbacks;
        // a cold local build must have time to acknowledge that durable work.
        signal: AbortSignal.timeout(30_000),
        cache: "no-store",
      },
    );
  } catch (error) {
    if (!(error instanceof TypeError) && !(error instanceof DOMException)) throw error;
    const durable = await new RunRepository(application.database).read(run.ownerUserId, run.id);
    if (durable.status !== "queued") return;
    throw new ProblemError({
      title: "Research service unavailable",
      status: 503,
      code: "agent_unavailable",
    });
  }
  if (!response.ok)
    throw new ProblemError({
      title: "Research service unavailable",
      status: 503,
      code: "agent_unavailable",
    });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new ProblemError({
      title: "Invalid research acknowledgement",
      status: 502,
      code: "invalid_agent_response",
    });
  }
  const acknowledged = AgentRunSchema.safeParse(payload);
  if (
    !acknowledged.success ||
    acknowledged.data.id !== run.id ||
    acknowledged.data.requestId !== run.requestId ||
    acknowledged.data.tripId !== run.tripId ||
    acknowledged.data.conversationId !== run.conversationId ||
    acknowledged.data.baseTripVersion !== run.baseTripVersion
  )
    throw new ProblemError({
      title: "Invalid research acknowledgement",
      status: 502,
      code: "invalid_agent_response",
    });
}
