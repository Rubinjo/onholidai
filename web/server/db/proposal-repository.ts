import { createHash } from "node:crypto";

import { changeProposalSchema, type ChangeProposal } from "@/domain/trip/proposal";
import { canonicalJson } from "@/domain/canonical-json";
import { TripVersionConflictError } from "@/domain/trip/commit";
import { inTransaction } from "@/server/db/transaction";
import { ProblemError } from "@/server/errors";

import type { ServiceTokenContext } from "@/server/agent-client/credentials";
import type { Database } from "@/server/db/database";
import type { Kysely } from "kysely";

function conflict(): never {
  throw new ProblemError({
    title: "Proposal identity conflict",
    code: "proposal_conflict",
    status: 409,
  });
}

export class ProposalRepository {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(context: ServiceTokenContext, rawProposal: unknown): Promise<ChangeProposal> {
    const proposal = changeProposalSchema.parse(rawProposal);
    if (
      proposal.tripId !== context.tripId ||
      proposal.initiatingRequestId !== context.requestId ||
      proposal.baseTripVersion !== context.baseTripVersion ||
      proposal.status !== "proposed"
    )
      conflict();
    const fingerprint = createHash("sha256").update(canonicalJson(proposal)).digest("hex");
    return inTransaction(this.database, async (transaction) => {
      const trip = await transaction
        .selectFrom("trips")
        .select(["ownerUserId", "currentVersion"])
        .where("id", "=", context.tripId)
        .forUpdate()
        .executeTakeFirst();
      if (!trip || trip.ownerUserId !== context.userId) {
        throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
      }
      const run = await transaction
        .selectFrom("agentRuns")
        .selectAll()
        .where("id", "=", proposal.agentRunId)
        .executeTakeFirst();
      if (
        !run ||
        run.ownerUserId !== context.userId ||
        run.tripId !== context.tripId ||
        run.requestId !== context.requestId ||
        run.baseTripVersion !== context.baseTripVersion ||
        run.purpose !== proposal.purpose
      )
        conflict();
      const existing = await transaction
        .selectFrom("changeProposals")
        .selectAll()
        .where("id", "=", proposal.id)
        .executeTakeFirst();
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) conflict();
        return changeProposalSchema.parse({ ...existing.proposal, status: existing.status });
      }
      if (trip.currentVersion !== proposal.baseTripVersion)
        throw new TripVersionConflictError(proposal.baseTripVersion, trip.currentVersion);
      if (
        Date.parse(proposal.expiresAt) <= this.now().getTime() ||
        Date.parse(proposal.createdAt) > this.now().getTime() ||
        !run.leaseExpiresAt ||
        run.leaseExpiresAt.getTime() <= this.now().getTime() ||
        !["queued", "running"].includes(run.status)
      )
        conflict();
      await transaction
        .insertInto("changeProposals")
        .values({
          id: proposal.id,
          tripId: proposal.tripId,
          agentRunId: proposal.agentRunId,
          initiatingRequestId: proposal.initiatingRequestId,
          baseTripVersion: proposal.baseTripVersion,
          purpose: proposal.purpose,
          proposal,
          requestFingerprint: fingerprint,
          status: proposal.status,
          createdAt: new Date(proposal.createdAt),
          expiresAt: new Date(proposal.expiresAt),
          appliedVersion: null,
        })
        .executeTakeFirstOrThrow();
      return proposal;
    });
  }

  async read(ownerUserId: string, tripId: string, proposalId: string): Promise<ChangeProposal> {
    const stored = await this.database
      .selectFrom("changeProposals")
      .innerJoin("trips", "trips.id", "changeProposals.tripId")
      .select(["changeProposals.proposal", "changeProposals.status"])
      .where("trips.ownerUserId", "=", ownerUserId)
      .where("trips.id", "=", tripId)
      .where("changeProposals.id", "=", proposalId)
      .executeTakeFirst();
    if (!stored)
      throw new ProblemError({
        title: "Proposal not found",
        status: 404,
        code: "proposal_not_found",
      });
    return changeProposalSchema.parse({ ...stored.proposal, status: stored.status });
  }
}
