import { ProposalRepository } from "@/server/db/proposal-repository";

import { RunRepository } from "./run-repository";

import type { AgentEvent } from "../../../contracts/agent-api/generated";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";

const RETRYABLE_RESEARCH = new Set(["deadline", "rate_limited", "error"]);
const FAILURE_MESSAGES: Record<string, string> = {
  deadline:
    "Supplier research did not finish in time. Retry to refresh the steps that were still running; your reviewed settings and draft are unchanged.",
  source_unavailable:
    "No supplier returned usable current inventory for this request. Retry to try the same steps again; your reviewed settings and draft are unchanged.",
  interrupted:
    "This update was interrupted before it completed. Retry to run it again; your reviewed settings and draft are unchanged.",
  invalid_result:
    "The returned supplier evidence could not be validated, so nothing was applied. Retry, or adjust the reviewed settings.",
  agent_error:
    "Research failed with an unexpected error, so nothing was applied. Retry; your reviewed settings and draft are unchanged.",
};

interface ResearchSummary {
  outcomes: Array<{
    provider: string | null;
    componentType: string;
    status: string;
    mode: string;
    safeReason: string;
    retryable: boolean;
    retryAfterMs: number | null;
    unverifiedCount: number;
    reused: boolean;
  }>;
  retryableComponentTypes: string[];
  incomplete: boolean;
}

function researchSummary(researchResult: unknown): ResearchSummary | null {
  const outcomes = (researchResult as { outcomes?: unknown } | null)?.outcomes;
  if (!Array.isArray(outcomes) || !outcomes.length) return null;
  const summary = outcomes
    .slice(0, 16)
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
    )
    .map((entry) => ({
      provider: typeof entry.provider === "string" ? entry.provider : null,
      componentType: String(entry.componentType ?? ""),
      status: String(entry.status ?? ""),
      mode: String(entry.mode ?? "unknown"),
      safeReason: String(entry.safeReason ?? ""),
      retryable: entry.retryable === true,
      retryAfterMs: typeof entry.retryAfterMs === "number" ? entry.retryAfterMs : null,
      unverifiedCount: typeof entry.unverifiedCount === "number" ? entry.unverifiedCount : 0,
      reused: entry.reused === true,
    }));
  const retryableComponentTypes = [
    ...new Set(
      summary
        .filter((entry) => entry.retryable && RETRYABLE_RESEARCH.has(entry.status))
        .map((entry) => entry.componentType)
        .filter(Boolean),
    ),
  ];
  return {
    outcomes: summary,
    retryableComponentTypes,
    incomplete: summary.some(
      (entry) => RETRYABLE_RESEARCH.has(entry.status) || entry.status === "access_blocked",
    ),
  };
}

export async function publicRun(database: Kysely<Database>, userId: string, runId: string) {
  const { ownerUserId: _owner, ...run } = await new RunRepository(database).read(userId, runId);
  void _owner;
  const policy = await database
    .selectFrom("agentRuns")
    .select("applicationPolicy")
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  // Supplier status is optional evidence: older runs and mocked readers may not carry it.
  const status = await database
    .selectFrom("agentRuns")
    .select(["researchResult", "errorCategory"])
    .where("id", "=", runId)
    .executeTakeFirst();
  const research = researchSummary(status?.researchResult ?? null);
  // An actionable status replaces the generic "research interrupted" copy.
  const failure = status?.errorCategory
    ? {
        category: status.errorCategory,
        message: FAILURE_MESSAGES[status.errorCategory] ?? FAILURE_MESSAGES.interrupted,
      }
    : run.interruptionReason
      ? { category: "interrupted" as const, message: FAILURE_MESSAGES.interrupted }
      : null;
  if (run.result?.kind === "proposal") {
    if (policy.applicationPolicy === "automatic") {
      const checkpoint = await database
        .selectFrom("tripVersions")
        .select("changeSummary")
        .where("tripId", "=", run.tripId)
        .where("proposalId", "=", run.result.proposal.id)
        .executeTakeFirst();
      // Never ship the full proposal/itinerary for an automatically applied update.
      return {
        ...run,
        research,
        failure,
        result: {
          kind: "answer" as const,
          message: checkpoint
            ? checkpoint.changeSummary.join(" ")
            : "This update did not change your saved trip. Send a fresh request to use its current version and availability.",
        },
      };
    }
    const proposal = await new ProposalRepository(database).read(
      userId,
      run.tripId,
      run.result.proposal.id,
    );
    return {
      ...run,
      research,
      failure,
      result: {
        kind: "proposal" as const,
        message: "Review these draft changes before accepting.",
        proposal,
      },
    };
  }
  return { ...run, research, failure };
}
export async function publicEvents(
  database: Kysely<Database>,
  userId: string,
  runId: string,
  after: number,
) {
  const repository = new RunRepository(database),
    run = await repository.read(userId, runId);
  const events = await repository.events(userId, runId, after);
  const policy = await database
    .selectFrom("agentRuns")
    .select("applicationPolicy")
    .where("id", "=", runId)
    .executeTakeFirstOrThrow();
  return Promise.all(
    events.map(async (event: AgentEvent) => {
      if (event.type !== "proposal") return publicEventEnvelope(event);
      if (policy.applicationPolicy === "automatic")
        return publicEventEnvelope({
          version: "1",
          runId,
          cursor: event.cursor,
          occurredAt: event.occurredAt,
          type: "progress",
          stage: "composing",
          message: "Planning update processed; see the conversation for its outcome.",
        });
      // Persisted internal proposal events can precede trusted pricing; never expose an unpriced preview as ready.
      if (run.status !== "proposed")
        return publicEventEnvelope({
          version: "1",
          runId,
          cursor: event.cursor,
          occurredAt: event.occurredAt,
          type: "progress",
          stage: "composing",
          message: "Preparing a trusted estimate preview",
        });
      return publicEventEnvelope(
        event,
        await new ProposalRepository(database).read(userId, run.tripId, event.proposal.id),
      );
    }),
  );
}
export function publicEventEnvelope(
  event: AgentEvent,
  proposal?: import("@/domain/trip/proposal").ChangeProposal,
) {
  const { version, runId, cursor, type, occurredAt, ...payload } = event;
  if (type === "proposal" && !proposal)
    throw new Error("A trusted priced proposal is required for public delivery");
  return {
    version,
    runId,
    cursor,
    type,
    occurredAt,
    payload: type === "proposal" ? { proposal } : payload,
  };
}
