import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";
import { acceptEstimate, acceptEstimateSchema } from "./apply-estimate";
import { commitTripMutation } from "./commit";
import { readOwnedTripVersion, readTrip } from "./read";
import { ProposalRepository } from "@/server/db/proposal-repository";
import { IdempotencyRepository } from "@/server/db/idempotency-repository";
import { tripSnapshotSchema } from "./schema";

export async function acceptProposal(database: Kysely<Database>, userId: string, tripId: string, proposalId: string, raw: unknown) {
  const proposal = await new ProposalRepository(database).read(userId, tripId, proposalId);
  if (proposal.purpose === "initial_estimate") return acceptEstimate(database, userId, tripId, proposalId, raw);
  const input = acceptEstimateSchema.parse(raw);
  return database.transaction().execute(async (transaction) => {
    const trip = await transaction.selectFrom("trips").selectAll().where("id", "=", tripId).where("ownerUserId", "=", userId).forUpdate().executeTakeFirst();
    const row = await transaction.selectFrom("changeProposals").selectAll().where("id", "=", proposalId).where("tripId", "=", tripId).forUpdate().executeTakeFirst();
    const candidate = await transaction.selectFrom("estimateCandidates").select("snapshot").where("proposalId", "=", proposalId).executeTakeFirst();
    if (!trip || trip.lifecycleState !== "draft" || !row || !["refinement", "finalization"].includes(row.purpose) || !candidate || row.baseTripVersion !== input.expectedVersion) runConflict();
    if (row.status !== "applied") {
      if (row.status !== "proposed" || row.expiresAt.getTime() <= Date.now() || trip.currentVersion !== input.expectedVersion) runConflict();
      const run = await transaction.selectFrom("agentRuns").selectAll().where("id", "=", row.agentRunId).executeTakeFirst();
      if (!run || run.status !== "proposed" || run.result?.kind !== "proposal" || (run.result.proposal as { id?: string })?.id !== proposalId || !run.resultFingerprint || run.resultCursor !== run.eventCursor) runConflict();
      if (candidate.snapshot.components.some((component) => component.bookingStatus !== "unbooked"
        || row.purpose === "refinement" && (component.offerStatus !== "available" || (component.expiresAt && Date.parse(component.expiresAt) <= Date.now())))) runConflict();
      await transaction.updateTable("changeProposals").set({ status: "accepted" }).where("id", "=", proposalId).execute();
    }
    const base = await readOwnedTripVersion(transaction, userId, tripId, input.expectedVersion);
    if (base.snapshot.components.some((component) => component.bookingStatus !== "unbooked")) runConflict();
    const receipt = await commitTripMutation(transaction, { tripId, ownerUserId: userId, expectedVersion: input.expectedVersion, requestId: input.requestId, idempotencyKey: input.requestId,
      requestFingerprint: fingerprint({ proposalId, ...input }), snapshot: tripSnapshotSchema.parse(candidate.snapshot), initiatingActor: "agent_proposal", proposalId,
      changeSummary: row.proposal.affectedFacts, inverseOperation: { operation: "replace", target: "/", value: base.snapshot }, nonReversibleReason: null, outboxEventId: randomUUID(), auditEventId: randomUUID() });
    if (row.status !== "applied") await transaction.updateTable("changeProposals").set({ status: "applied", appliedVersion: receipt.version }).where("id", "=", proposalId).execute();
    return readTrip(transaction, userId, tripId, { version: receipt.version });
  });
}

export async function rejectProposal(database: Kysely<Database>, userId: string, tripId: string, proposalId: string, raw: unknown) {
  const input = acceptEstimateSchema.extend({ reason: z.string().trim().max(500).optional() }).parse(raw);
  await new ProposalRepository(database).read(userId, tripId, proposalId);
  return database.transaction().execute(async (transaction) => {
    const trip = await transaction.selectFrom("trips").selectAll().where("id", "=", tripId).where("ownerUserId", "=", userId).forUpdate().executeTakeFirst();
    const row = await transaction.selectFrom("changeProposals").selectAll().where("id", "=", proposalId).where("tripId", "=", tripId).forUpdate().executeTakeFirst();
    if (!trip || !row || row.baseTripVersion !== input.expectedVersion || !["proposed", "rejected", "needs_clarification"].includes(row.status)) runConflict();
    const receipts = new IdempotencyRepository(transaction), scope = `trip:${tripId}:proposal:reject`, hash = fingerprint({ userId, proposalId, ...input });
    const claim = await receipts.claim({ scope, key: input.requestId, requestFingerprint: hash, expiresAt: new Date(Date.now() + 86400000) });
    if (claim.kind === "replay") return claim.result;
    if (row.status !== "rejected") await transaction.updateTable("changeProposals").set({ status: "rejected" }).where("id", "=", proposalId).execute();
    const result = await new ProposalRepository(transaction).read(userId, tripId, proposalId);
    await receipts.complete(scope, input.requestId, hash, { ...result });
    return result;
  });
}
