import { inTransaction } from "@/server/db/transaction";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";
import { ProposalRepository } from "@/server/db/proposal-repository";
import { selectedRunOffers } from "@/server/supply/planning-research";
import { isCompletePlanningOffer } from "@/server/supply/offers";
import { projectCustomerSnapshot } from "@/domain/pricing/projections";
import { ProblemError } from "@/server/errors";

import { researchDraftImpact } from "./edit";
import { readOwnedTripVersion } from "./read";
import { changeProposalSchema } from "./proposal";
import { tripSnapshotSchema } from "./schema";
import { previewFinalization } from "./finalization-proposal";
import { assertSelectedOfferRequirements, priceEstimate } from "./apply-estimate";
import { previewDraftEdit } from "./impact";

import type { SupplyReadProvider } from "@/server/supply/read";
import type { ServiceTokenContext } from "@/server/agent-client/credentials";
import type { SupplierReadiness } from "@/server/config";
import type { Database } from "@/server/db/database";
import type { Kysely } from "kysely";
import type { ChangeProposal as AgentProposal } from "@contracts/agent-api/generated";

export async function recordRefinement(
  database: Kysely<Database>,
  context: ServiceTokenContext,
  runId: string,
  proposal: AgentProposal,
  providers: readonly SupplyReadProvider[],
  options: { readiness?: SupplierReadiness } = {},
) {
  if (
    !["refinement", "finalization"].includes(proposal.purpose) ||
    proposal.initiatingRequestId !== context.requestId ||
    proposal.baseTripVersion !== context.baseTripVersion
  )
    runConflict();
  const existing = await database
    .selectFrom("estimateCandidates")
    .select("proposalId")
    .where("proposalId", "=", proposal.id)
    .executeTakeFirst();
  if (existing) {
    const saved = await new ProposalRepository(database).read(
      context.userId,
      context.tripId,
      proposal.id,
    );
    if (
      saved.agentRunId !== runId ||
      saved.initiatingRequestId !== context.requestId ||
      fingerprint(saved.operations) !== fingerprint(proposal.operations) ||
      saved.rationale !== proposal.rationale ||
      saved.expiresAt !== proposal.expiresAt
    )
      runConflict();
    return saved;
  }
  const base = await readOwnedTripVersion(
    database,
    context.userId,
    context.tripId,
    context.baseTripVersion,
  );
  const selected =
    proposal.purpose === "refinement" ? await selectedRunOffers(database, context, runId) : [];
  if (
    selected.length &&
    (proposal.operations.some((operation) => operation.target !== "/components") ||
      selected.some(
        ({ normalizedOffer: offer }) =>
          !isCompletePlanningOffer(offer) || offer.eligibility.status === "ineligible",
      ))
  )
    throw new ProblemError({
      title: "Selected source facts cannot be materialized",
      status: 409,
      code: "offer_unavailable",
    });
  const baseSnapshot = tripSnapshotSchema.parse(base.snapshot);
  const selectedSnapshot = selected.length
    ? priceEstimate(
        baseSnapshot,
        proposal.operations,
        selected.map((record) => record.normalizedOffer),
        new Date(),
        true,
      )
    : undefined;
  if (selectedSnapshot)
    assertSelectedOfferRequirements(
      baseSnapshot,
      selectedSnapshot,
      selected.map((record) => record.normalizedOffer),
    );
  // Day-plan-only changes are trusted planning (never supplier facts), so they take the
  // finalization review instead of a full reprice; anything else re-reads inventory.
  const dayPlanOnly = proposal.operations.every(
    (operation) => operation.target === "/itineraryDays",
  );
  const review = selectedSnapshot
    ? previewDraftEdit(baseSnapshot, context.baseTripVersion, proposal.operations, selectedSnapshot)
    : proposal.purpose === "finalization" || dayPlanOnly
      ? previewFinalization(tripSnapshotSchema.parse(base.snapshot), proposal.operations)
      : await researchDraftImpact(
          tripSnapshotSchema.parse(base.snapshot),
          context.baseTripVersion,
          proposal.operations,
          providers,
          options,
        );
  if (selected.length) {
    const ids = new Set(selected.map((record) => record.componentId));
    const proposedIds = new Set(review.snapshot.components.map((component) => component.id));
    if (
      [...ids].some((id) => !proposedIds.has(id)) ||
      review.snapshot.components.some(
        (component) =>
          !ids.has(component.id) &&
          !baseSnapshot.components.some((entry) => entry.id === component.id),
      )
    )
      runConflict();
    review.previewSnapshot = projectCustomerSnapshot(review.snapshot);
    review.priceImpact.afterMinor = review.snapshot.price.finalCustomerTotal.minorUnits;
    review.priceImpact.deltaMinor = review.priceImpact.afterMinor - review.priceImpact.beforeMinor;
    review.warnings = [
      "Selected current research was materialized from stored source facts, not model prices. No inventory is reserved.",
      "Eligibility, terms and availability remain subject to verification before exact booking review.",
    ];
  }
  const value = changeProposalSchema.parse({
    ...proposal,
    tripId: context.tripId,
    agentRunId: runId,
    status: "proposed",
    createdAt: new Date().toISOString(),
    previewSnapshot: review.previewSnapshot,
    priceImpact: review.priceImpact,
    scheduleImpact: review.scheduleImpact,
    affectedFacts: review.affectedFacts,
    warnings: [...proposal.warnings, ...review.warnings].slice(0, 64),
  });
  return inTransaction(database, async (transaction) => {
    const trip = await transaction
      .selectFrom("trips")
      .select("id")
      .where("id", "=", context.tripId)
      .where("ownerUserId", "=", context.userId)
      .forUpdate()
      .executeTakeFirst();
    if (!trip) runConflict();
    const prior = await transaction
      .selectFrom("estimateCandidates")
      .select("proposalId")
      .where("proposalId", "=", proposal.id)
      .executeTakeFirst();
    if (prior) {
      const saved = await new ProposalRepository(transaction).read(
        context.userId,
        context.tripId,
        proposal.id,
      );
      if (
        saved.agentRunId !== runId ||
        saved.initiatingRequestId !== context.requestId ||
        fingerprint(saved.operations) !== fingerprint(proposal.operations) ||
        saved.rationale !== proposal.rationale ||
        saved.expiresAt !== proposal.expiresAt
      )
        runConflict();
      return saved;
    }
    const saved = await new ProposalRepository(transaction).record(context, value);
    await transaction
      .insertInto("estimateCandidates")
      .values({ proposalId: proposal.id, snapshot: review.snapshot })
      .execute();
    return saved;
  });
}
