import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { ChangeProposal as AgentProposal } from "../../../contracts/agent-api/generated";
import { projectCustomerSnapshot } from "@/domain/pricing/projections";
import { planningOfferSchema, type PlanningOffer } from "@/server/supply/offers";
import { ProposalRepository } from "@/server/db/proposal-repository";
import type { Database } from "@/server/db/database";
import { ProblemError } from "@/server/errors";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";
import type { ServiceTokenContext } from "@/server/agent-client/credentials";
import { applyDraftOperations } from "./operations";
import { readOwnedTripVersion, readTrip } from "./read";
import { changeProposalSchema } from "./proposal";
import { commitTripMutation } from "./commit";
import { tripSnapshotSchema, type TripSnapshot } from "./schema";

export function priceEstimate(base: TripSnapshot, operations: readonly unknown[], offers: readonly PlanningOffer[], now: Date): TripSnapshot {
  const candidate = applyDraftOperations(base, operations, false);
  candidate.components = candidate.components.map((component) => {
    const offer = offers.find((entry) => entry.component.id === component.id);
    if (!offer || offer.component.price.finalCustomerAmount.currency !== base.price.currency
      || offer.component.bookingStatus !== "unbooked" || offer.component.offerStatus !== "available"
      || (offer.component.expiresAt && Date.parse(offer.component.expiresAt) <= now.getTime())) {
      throw new ProblemError({ title: "Planning offer unavailable", status: 409, code: "offer_unavailable" });
    }
    // Every material offer fact and monetary amount comes from web-owned supply records.
    return structuredClone(offer.component);
  });
  if (!candidate.components.some((component) => ["flight", "rail", "transfer"].includes(component.type))
    || (candidate.destinations.some((destination) => destination.plannedNights > 0)
      && !candidate.components.some((component) => component.type === "accommodation"))) {
    throw new ProblemError({ title: "Essential planning sources unavailable", status: 409, code: "incomplete_estimate" });
  }
  const currency = base.price.currency;
  const sum = (field: "supplierAmount" | "platformMargin" | "customerPayableTaxes" | "customerPayableFees" | "finalCustomerAmount") => {
    const minorUnits = candidate.components.reduce((total, component) => total + component.price[field].minorUnits, 0);
    if (!Number.isSafeInteger(minorUnits)) throw new Error("Price overflow");
    return { currency, minorUnits };
  };
  candidate.price = { currency, supplierTotal: sum("supplierAmount"), platformMarginTotal: sum("platformMargin"),
    customerPayableTaxesTotal: sum("customerPayableTaxes"), customerPayableFeesTotal: sum("customerPayableFees"),
    finalCustomerTotal: sum("finalCustomerAmount"), status: "estimated", checkedAt: now.toISOString(), conversionDisclosures: [] };
  return tripSnapshotSchema.parse(candidate);
}

export async function recordEstimate(database: Kysely<Database>, context: ServiceTokenContext, runId: string,
  proposal: AgentProposal, now = new Date()) {
  if (proposal.purpose !== "initial_estimate" || proposal.initiatingRequestId !== context.requestId
    || proposal.baseTripVersion !== context.baseTripVersion) runConflict();
  const existing = await database.selectFrom("estimateCandidates").select("proposalId").where("proposalId", "=", proposal.id).executeTakeFirst();
  if (existing) {
    const saved = await new ProposalRepository(database).read(context.userId, context.tripId, proposal.id);
    if (saved.agentRunId !== runId || saved.initiatingRequestId !== context.requestId || saved.baseTripVersion !== context.baseTripVersion
      || fingerprint({ operations: saved.operations, rationale: saved.rationale, affectedFacts: saved.affectedFacts, expiresAt: saved.expiresAt })
        !== fingerprint({ operations: proposal.operations, rationale: proposal.rationale, affectedFacts: proposal.affectedFacts, expiresAt: proposal.expiresAt })) runConflict();
    return saved;
  }
  const stored = await readOwnedTripVersion(database, context.userId, context.tripId, context.baseTripVersion);
  const records = await database.selectFrom("planningOfferRecords").select(["componentId", "offer", "query"]).where("runId", "=", runId).execute();
  const offers = records.map((record) => planningOfferSchema.parse(record.offer));
  const candidate = priceEstimate(stored.snapshot, proposal.operations, offers, now);
  const scheduled = candidate.destinations.filter((destination) => destination.arrivalDate && destination.departureDate);
  const startDate = scheduled.map((destination) => destination.arrivalDate!).sort()[0];
  const endDate = scheduled.map((destination) => destination.departureDate!).sort().at(-1);
  for (const component of candidate.components) {
    const record = records.find((entry) => entry.componentId === component.id);
    const query = record?.query;
    if (!query || query.currency !== candidate.price.currency || query.startDate !== startDate || query.endDate !== endDate
      || fingerprint(query.departureOrigin) !== fingerprint(candidate.departureOrigin)
      || fingerprint(query.travellerParty) !== fingerprint(candidate.travellerParty)
      || fingerprint(query.destinationIds) !== fingerprint(candidate.destinations.map((destination) => destination.id))) runConflict();
  }
  const snapshot = projectCustomerSnapshot(candidate), total = snapshot.price.finalCustomerMinor;
  const publicProposal = changeProposalSchema.parse({ ...proposal, tripId: context.tripId, agentRunId: runId,
    warnings: [...proposal.warnings, "Illustrative cost range uses 90–120% of current planning prices, not a supplier guarantee.", ...(offers.every((offer) => offer.component.supplierOfferId.startsWith("synthetic-"))
      ? ["Deterministic synthetic offers: these are not live supplier quotes or availability."] : [])].slice(0, 64),
    createdAt: now.toISOString(), status: "proposed", previewSnapshot: snapshot,
    estimatedCostRange: { currency: snapshot.price.currency, minimumMinor: Math.floor(total * 0.9), maximumMinor: Math.ceil(total * 1.2) },
    styleCompatibility: `Pace ${candidate.preferences.pace}/100; spend ${candidate.preferences.spend}/100; discovery ${candidate.preferences.discovery}/100; independence ${candidate.preferences.independence}/100; setting ${candidate.preferences.setting}/100. Draft style fit, not a guarantee.`,
    constraintSummary: candidate.constraints.filter((constraint) => constraint.status !== "removed").map((constraint) =>
      `${constraint.priority}: ${constraint.statement.slice(0, 850)} — ${constraint.status === "conflicting" ? "conflicting" : "unverified; confirm with sources before booking"}`),
  });
  // Candidate and public review evidence must appear together, never a partially reviewable proposal.
  await database.transaction().execute(async (transaction) => {
    await new ProposalRepository(transaction, () => now).record(context, publicProposal);
    await transaction.insertInto("estimateCandidates").values({ proposalId: proposal.id, snapshot: candidate })
      .onConflict((conflict) => conflict.column("proposalId").doNothing()).execute();
  });
  return publicProposal;
}

export const acceptEstimateSchema = z.object({ requestId: z.uuid(), expectedVersion: z.number().int().positive() }).strict();
export async function acceptEstimate(database: Kysely<Database>, userId: string, tripId: string, proposalId: string, raw: unknown) {
  const input = acceptEstimateSchema.parse(raw);
  return database.transaction().execute(async (transaction) => {
    // Same lock order as proposal recording: trip, proposal, then the sole commit boundary.
    const trip = await transaction.selectFrom("trips").selectAll().where("id", "=", tripId).where("ownerUserId", "=", userId).forUpdate().executeTakeFirst();
    if (!trip) throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
    const row = await transaction.selectFrom("changeProposals").selectAll().where("id", "=", proposalId).where("tripId", "=", tripId).forUpdate().executeTakeFirst();
    const candidate = await transaction.selectFrom("estimateCandidates").select("snapshot").where("proposalId", "=", proposalId).executeTakeFirst();
    if (!row || !candidate || row.purpose !== "initial_estimate") runConflict();
    if (input.expectedVersion !== row.baseTripVersion) runConflict();
    const base = await readOwnedTripVersion(transaction, userId, tripId, row.baseTripVersion);
    const snapshot = tripSnapshotSchema.parse(candidate.snapshot);
    if (row.status !== "applied") {
      if (row.status !== "proposed" || row.expiresAt <= new Date() || trip.currentVersion !== input.expectedVersion) runConflict();
      const run = await transaction.selectFrom("agentRuns").select(["status", "result", "resultCursor", "eventCursor", "resultFingerprint"])
        .where("id", "=", row.agentRunId).where("ownerUserId", "=", userId).executeTakeFirst();
      const resultProposal = run?.result?.proposal as Record<string, unknown> | undefined;
      if (!run || run.status !== "proposed" || run.result?.kind !== "proposal" || resultProposal?.id !== proposalId
        || run.resultCursor !== run.eventCursor || !run.resultFingerprint) runConflict();
      if (snapshot.components.some((component) => component.offerStatus !== "available" || component.bookingStatus !== "unbooked"
        || [component.expiresAt, component.price.expiresAt].some((expiry) => expiry !== null && Date.parse(expiry) <= Date.now()))) {
        throw new ProblemError({ title: "Estimate offer expired", status: 409, code: "offer_expired" });
      }
      await transaction.updateTable("changeProposals").set({ status: "accepted" }).where("id", "=", proposalId).execute();
    }
    // Reversal records a validated draft root replacement; booking workflows remain unavailable.
    const receipt = await commitTripMutation(transaction, { tripId, ownerUserId: userId, expectedVersion: input.expectedVersion,
      requestId: input.requestId, idempotencyKey: input.requestId, requestFingerprint: fingerprint({ proposalId, ...input }),
      snapshot, initiatingActor: "agent_proposal", proposalId, changeSummary: row.proposal.affectedFacts,
      inverseOperation: { operation: "replace", target: "/", value: base.snapshot }, nonReversibleReason: null,
      outboxEventId: randomUUID(), auditEventId: randomUUID() });
    if (row.status !== "applied") await transaction.updateTable("changeProposals").set({ status: "applied", appliedVersion: receipt.version }).where("id", "=", proposalId).execute();
    return { ...(await readTrip(transaction, userId, tripId, { version: receipt.version })), lifecycleState: "draft" as const };
  });
}
