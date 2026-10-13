import type { AgentEvent } from "../../../contracts/agent-api/generated";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import { ProposalRepository } from "@/server/db/proposal-repository";
import { RunRepository } from "./run-repository";

export async function publicRun(database: Kysely<Database>, userId: string, runId: string) {
  const { ownerUserId: _owner, ...run } = await new RunRepository(database).read(userId, runId);
  void _owner;
  if (run.result?.kind === "proposal") {
    const proposal = await new ProposalRepository(database).read(userId, run.tripId, run.result.proposal.id);
    return { ...run, result: { kind: "proposal" as const, message: "Review this estimate before accepting.", proposal } };
  }
  return run;
}
export async function publicEvents(database: Kysely<Database>, userId: string, runId: string, after: number) {
  const repository = new RunRepository(database), run = await repository.read(userId, runId);
  const events = await repository.events(userId, runId, after);
  return Promise.all(events.map(async (event: AgentEvent) => {
    if (event.type !== "proposal") return publicEventEnvelope(event);
    // Persisted internal proposal events can precede trusted pricing; never expose an unpriced preview as ready.
    if (run.status !== "proposed") return publicEventEnvelope({ version: "1", runId, cursor: event.cursor, occurredAt: event.occurredAt,
      type: "progress", stage: "composing", message: "Preparing a trusted estimate preview" });
    return publicEventEnvelope(event, await new ProposalRepository(database).read(userId, run.tripId, event.proposal.id));
  }));
}
export function publicEventEnvelope(event: AgentEvent, proposal?: import("@/domain/trip/proposal").ChangeProposal) {
  const { version, runId, cursor, type, occurredAt, ...payload } = event;
  if (type === "proposal" && !proposal) throw new Error("A trusted priced proposal is required for public delivery");
  return { version, runId, cursor, type, occurredAt, payload: type === "proposal" ? { proposal } : payload };
}
