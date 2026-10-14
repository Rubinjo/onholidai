import { inTransaction } from "@/server/db/transaction";
import type { ChangeProposal as AgentProposal } from "@contracts/agent-api/generated";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import type { ServiceTokenContext } from "@/server/agent-client/credentials";
import type { SupplyReadProvider } from "@/server/supply/read";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";
import { ProposalRepository } from "@/server/db/proposal-repository";
import { researchDraftImpact } from "./edit";
import { readOwnedTripVersion } from "./read";
import { changeProposalSchema } from "./proposal";
import { tripSnapshotSchema } from "./schema";
import { previewFinalization } from "./finalization-proposal";

export async function recordRefinement(database: Kysely<Database>, context: ServiceTokenContext, runId: string, proposal: AgentProposal, providers: readonly SupplyReadProvider[]) {
  if (!["refinement", "finalization"].includes(proposal.purpose) || proposal.initiatingRequestId !== context.requestId || proposal.baseTripVersion !== context.baseTripVersion) runConflict();
  const existing = await database.selectFrom("estimateCandidates").select("proposalId").where("proposalId", "=", proposal.id).executeTakeFirst();
  if (existing) {
    const saved = await new ProposalRepository(database).read(context.userId, context.tripId, proposal.id);
    if (saved.agentRunId !== runId || saved.initiatingRequestId !== context.requestId || fingerprint(saved.operations) !== fingerprint(proposal.operations) || saved.rationale !== proposal.rationale || saved.expiresAt !== proposal.expiresAt) runConflict();
    return saved;
  }
  const base = await readOwnedTripVersion(database, context.userId, context.tripId, context.baseTripVersion);
  const review = proposal.purpose === "finalization"
    ? previewFinalization(tripSnapshotSchema.parse(base.snapshot), proposal.operations)
    : await researchDraftImpact(tripSnapshotSchema.parse(base.snapshot), context.baseTripVersion, proposal.operations, providers);
  const value = changeProposalSchema.parse({ ...proposal, tripId: context.tripId, agentRunId: runId, status: "proposed", createdAt: new Date().toISOString(),
    previewSnapshot: review.previewSnapshot, priceImpact: review.priceImpact, scheduleImpact: review.scheduleImpact, affectedFacts: review.affectedFacts,
    warnings: [...proposal.warnings, ...review.warnings].slice(0, 64) });
  return inTransaction(database, async (transaction) => {
    const trip = await transaction.selectFrom("trips").select("id").where("id", "=", context.tripId).where("ownerUserId", "=", context.userId).forUpdate().executeTakeFirst();
    if (!trip) runConflict();
    const prior = await transaction.selectFrom("estimateCandidates").select("proposalId").where("proposalId", "=", proposal.id).executeTakeFirst();
    if (prior) {
      const saved = await new ProposalRepository(transaction).read(context.userId, context.tripId, proposal.id);
      if (saved.agentRunId !== runId || saved.initiatingRequestId !== context.requestId || fingerprint(saved.operations) !== fingerprint(proposal.operations) || saved.rationale !== proposal.rationale || saved.expiresAt !== proposal.expiresAt) runConflict();
      return saved;
    }
    const saved = await new ProposalRepository(transaction).record(context, value);
    await transaction.insertInto("estimateCandidates").values({ proposalId: proposal.id, snapshot: review.snapshot }).execute();
    return saved;
  });
}
