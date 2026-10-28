import { randomUUID } from "node:crypto";

import { z } from "zod";

import { inTransaction } from "@/server/db/transaction";
import { projectCustomerSnapshot } from "@/domain/pricing/projections";
import {
  planningOfferSchema,
  isCompletePlanningOffer,
  materializePlanningOffer,
  type PlanningOffer,
} from "@/server/supply/offers";
import { ProposalRepository } from "@/server/db/proposal-repository";
import { ProblemError } from "@/server/errors";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";

import { applyDraftOperations } from "./operations";
import { readOwnedTripVersion, readTrip } from "./read";
import { changeProposalSchema } from "./proposal";
import { commitTripMutation } from "./commit";
import { tripSnapshotSchema, type TripSnapshot } from "./schema";
import { summarizeTripChanges } from "./change-summary";
import { serviceDate } from "./feasibility-policy";

import type { ServiceTokenContext } from "@/server/agent-client/credentials";
import type { ChangeProposal as AgentProposal } from "../../../contracts/agent-api/generated";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";

export function assertSelectedOfferRequirements(
  base: TripSnapshot,
  candidate: TripSnapshot,
  offers: readonly PlanningOffer[],
) {
  function unavailable(): never {
    throw new ProblemError({
      title: "Selected source facts do not satisfy the current trip requirements",
      status: 409,
      code: "offer_unavailable",
    });
  }
  const dates = base.destinations
    .flatMap((destination) =>
      destination.arrivalDate && destination.departureDate
        ? [destination.arrivalDate, destination.departureDate]
        : [],
    )
    .sort();
  const start = dates[0],
    end = dates.at(-1);
  if (!start || !end || base.components.some((component) => component.bookingStatus !== "unbooked"))
    unavailable();
  const groups = new Set<string>();
  for (const offer of offers) {
    if (!isCompletePlanningOffer(offer)) unavailable();
    const { component, eligibility, occupancy } = offer;
    const timezone = component.type === "flight" ? base.departureOrigin?.timezone : undefined;
    const group = offer.selectionGroup ?? component.id;
    if (groups.has(group)) unavailable();
    groups.add(group);
    if (
      eligibility.status === "ineligible" ||
      serviceDate(component.serviceStart, timezone) < start ||
      serviceDate(component.serviceEnd, timezone) > end ||
      component.price.finalCustomerAmount.currency !== base.price.currency ||
      offer.evidence?.availability === "unavailable" ||
      offer.evidence?.status === "expired"
    )
      unavailable();
    if (base.travellerParty.children.length && eligibility.status !== "eligible") unavailable();
    if (
      base.travellerParty.children.some(
        (child) =>
          (eligibility.minimumAge !== null && child.ageAtTripStart < eligibility.minimumAge) ||
          (eligibility.maximumAge !== null && child.ageAtTripStart > eligibility.maximumAge),
      )
    )
      unavailable();
    if (
      component.type === "accommodation" &&
      (occupancy.maximumAdults === null ||
        occupancy.maximumChildren === null ||
        occupancy.maximumAdults < base.travellerParty.adults ||
        occupancy.maximumChildren < base.travellerParty.children.length)
    )
      unavailable();
    for (const constraint of base.constraints) {
      if (
        constraint.priority !== "required" ||
        constraint.status === "removed" ||
        constraint.category === "budget"
      )
        continue;
      // Unsupported rail stays an outstanding requirement, not a substituted flight.
      if (constraint.category === "transport" && /\b(?:rail|train)\b/i.test(constraint.statement))
        continue;
      const scopedTypes = (
        [
          ["flight", /\bflights?\b/i],
          ["activity", /\b(?:activities|activity)\b/i],
          ["accommodation", /\b(?:stays?|hotels?|accommodation)\b/i],
          ["transfer", /\btransfers?\b/i],
          ["rail", /\b(?:rail|trains?)\b/i],
        ] as const
      ).filter(([, pattern]) => pattern.test(constraint.statement));
      const relevant =
        constraint.category === "accessibility" ||
        (constraint.category === "lodging" && component.type === "accommodation") ||
        (["dietary", "schedule"].includes(constraint.category) &&
          (scopedTypes.length
            ? scopedTypes.some(([kind]) => kind === component.type)
            : constraint.category === "schedule" || component.type === "activity")) ||
        (constraint.category === "transport" && ["flight", "transfer"].includes(component.type)) ||
        ["other", "occasion"].includes(constraint.category);
      if (!relevant) continue;
      const proof = component.planningDetails?.constraintEvidence.find(
        (entry) => entry.constraintId === constraint.id,
      )?.status;
      if (
        constraint.category === "accessibility"
          ? offer.accessibility !== "verified" || proof === "failed"
          : proof !== "verified"
      )
        unavailable();
    }
  }
  const selectedIds = new Set(offers.map((offer) => offer.component.id));
  if (
    candidate.components.some(
      (component) =>
        !selectedIds.has(component.id) &&
        !base.components.some((existing) => existing.id === component.id),
    ) ||
    [...selectedIds].some((id) => !candidate.components.some((component) => component.id === id))
  )
    unavailable();
  for (const existing of base.components) {
    if (candidate.components.some((component) => component.id === existing.id)) continue;
    if (
      existing.type === "activity" ||
      !offers.some(
        ({ component }) =>
          component.type === existing.type &&
          component.serviceStart === existing.serviceStart &&
          component.serviceEnd === existing.serviceEnd,
      )
    )
      unavailable();
  }
  if (
    offers.some(({ component }) => {
      const matches = base.components.filter(
        (existing) =>
          existing.type === component.type &&
          existing.serviceStart === component.serviceStart &&
          existing.serviceEnd === component.serviceEnd,
      );
      return (
        matches.length > 1 &&
        matches.some((existing) => !candidate.components.some((entry) => entry.id === existing.id))
      );
    })
  )
    unavailable();
  for (const constraint of base.constraints) {
    if (
      constraint.category !== "budget" ||
      constraint.priority !== "required" ||
      constraint.status === "removed"
    )
      continue;
    const match = /\b([A-Z]{3})\s+(\d+)(?:\.(\d{1,3}))?\b/.exec(constraint.statement);
    if (
      !match ||
      match[1] !== base.price.currency ||
      !/\b(?:max(?:imum)?|at most|up to|not exceed|no more than|under|within|budget)\b/i.test(
        constraint.statement,
      ) ||
      (constraint.statement.match(/\b[A-Z]{3}\s+\d/g) ?? []).length !== 1
    )
      unavailable();
    const precision = new Intl.NumberFormat("en", {
      style: "currency",
      currency: base.price.currency,
    }).resolvedOptions().maximumFractionDigits;
    const fraction = match[3] ?? "";
    if (precision === undefined || fraction.length > precision) unavailable();
    const limit =
      BigInt(match[2]) * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, "0") || "0");
    if (
      limit > BigInt(Number.MAX_SAFE_INTEGER) ||
      BigInt(candidate.price.finalCustomerTotal.minorUnits) > limit
    )
      unavailable();
  }
}

export function priceEstimate(
  base: TripSnapshot,
  operations: readonly unknown[],
  offers: readonly PlanningOffer[],
  now: Date,
  preserveExisting = false,
): TripSnapshot {
  const candidate = applyDraftOperations(base, operations, false);
  candidate.components = candidate.components.map((component) => {
    const offer = offers.find((entry) => entry.component.id === component.id);
    const existing = preserveExisting
      ? base.components.find((entry) => entry.id === component.id)
      : undefined;
    if (
      !offer &&
      existing &&
      existing.bookingStatus === "unbooked" &&
      existing.offerStatus === "available" &&
      (!existing.expiresAt || Date.parse(existing.expiresAt) > now.getTime())
    )
      return structuredClone(existing);
    if (
      !offer ||
      !isCompletePlanningOffer(offer) ||
      offer.component.price.finalCustomerAmount.currency !== base.price.currency ||
      offer.component.bookingStatus !== "unbooked" ||
      offer.component.offerStatus !== "available" ||
      (offer.component.expiresAt && Date.parse(offer.component.expiresAt) <= now.getTime())
    ) {
      throw new ProblemError({
        title: "Planning offer unavailable",
        status: 409,
        code: "offer_unavailable",
      });
    }
    // Every material offer fact and monetary amount comes from web-owned supply records.
    return structuredClone(materializePlanningOffer(offer).component);
  });
  if (
    !candidate.components.some((component) =>
      ["flight", "rail", "transfer"].includes(component.type),
    ) ||
    (candidate.destinations.some((destination) => destination.plannedNights > 0) &&
      !candidate.components.some((component) => component.type === "accommodation"))
  ) {
    throw new ProblemError({
      title: "Essential planning sources unavailable",
      status: 409,
      code: "incomplete_estimate",
    });
  }
  const currency = base.price.currency;
  // A part the suppliers did not establish stays null rather than being reported as zero.
  const sum = (
    field:
      | "supplierAmount"
      | "platformMargin"
      | "customerPayableTaxes"
      | "customerPayableFees"
      | "finalCustomerAmount",
  ) => {
    if (candidate.components.some((component) => component.price[field] === null)) return null;
    const minorUnits = candidate.components.reduce(
      (total, component) => total + (component.price[field]?.minorUnits ?? 0),
      0,
    );
    if (!Number.isSafeInteger(minorUnits)) throw new Error("Price overflow");
    return { currency, minorUnits };
  };
  const finalTotal = sum("finalCustomerAmount");
  // Every draft component carries a payable total, so this cannot be unknown.
  if (finalTotal === null) throw new Error("Missing component payable total");
  candidate.price = {
    currency,
    supplierTotal: sum("supplierAmount"),
    platformMarginTotal: sum("platformMargin"),
    customerPayableTaxesTotal: sum("customerPayableTaxes"),
    customerPayableFeesTotal: sum("customerPayableFees"),
    finalCustomerTotal: finalTotal,
    status: "estimated",
    checkedAt: now.toISOString(),
    conversionDisclosures: [],
  };
  return tripSnapshotSchema.parse(candidate);
}

export async function recordEstimate(
  database: Kysely<Database>,
  context: ServiceTokenContext,
  runId: string,
  proposal: AgentProposal,
  now = new Date(),
) {
  if (
    proposal.purpose !== "initial_estimate" ||
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
      saved.baseTripVersion !== context.baseTripVersion ||
      fingerprint({
        operations: saved.operations,
        rationale: saved.rationale,
        affectedFacts: saved.affectedFacts,
        expiresAt: saved.expiresAt,
      }) !==
        fingerprint({
          operations: proposal.operations,
          rationale: proposal.rationale,
          affectedFacts: proposal.affectedFacts,
          expiresAt: proposal.expiresAt,
        })
    )
      runConflict();
    return saved;
  }
  const stored = await readOwnedTripVersion(
    database,
    context.userId,
    context.tripId,
    context.baseTripVersion,
  );
  const records = await database
    .selectFrom("planningOfferRecords")
    .select(["componentId", "offer", "query"])
    .where("runId", "=", runId)
    .execute();
  const offers = records.map((record) => planningOfferSchema.parse(record.offer));
  const candidate = priceEstimate(stored.snapshot, proposal.operations, offers, now);
  const scheduled = candidate.destinations.filter(
    (destination) => destination.arrivalDate && destination.departureDate,
  );
  const startDate = scheduled.map((destination) => destination.arrivalDate!).sort()[0];
  const endDate = scheduled
    .map((destination) => destination.departureDate!)
    .sort()
    .at(-1);
  for (const component of candidate.components) {
    const record = records.find((entry) => entry.componentId === component.id);
    const query = record?.query;
    const offer = offers.find((entry) => entry.component.id === component.id);
    const stop =
      ["accommodation", "activity"].includes(component.type) && candidate.destinations.length > 1
        ? candidate.destinations.find(
            (_, index) => offer?.selectionGroup === `${component.type}:stop:${index}`,
          )
        : undefined;
    // This evidence must describe the same search the traveller's dates, party and route
    // imply. A mismatch means the proposal cannot be priced from the recorded research.
    const mismatch = !query
      ? "missing_evidence"
      : query.currency !== candidate.price.currency
        ? "currency"
        : query.startDate !== (stop?.arrivalDate ?? startDate)
          ? "start_date"
          : query.endDate !== (stop?.departureDate ?? endDate)
            ? "end_date"
            : fingerprint(query.departureOrigin) !== fingerprint(candidate.departureOrigin)
              ? "departure_origin"
              : fingerprint(query.travellerParty) !== fingerprint(candidate.travellerParty)
                ? "traveller_party"
                : fingerprint(query.destinationIds) !==
                    fingerprint(
                      stop
                        ? [stop.id]
                        : candidate.destinations.map((destination) => destination.id),
                    )
                  ? "destinations"
                  : null;
    if (mismatch)
      throw new ProblemError({
        title: "Estimate evidence does not match the proposed trip",
        status: 409,
        code: `estimate_evidence_${mismatch}`,
      });
  }
  const snapshot = projectCustomerSnapshot(candidate),
    total = snapshot.price.finalCustomerMinor;
  const publicProposal = changeProposalSchema.parse({
    ...proposal,
    tripId: context.tripId,
    agentRunId: runId,
    warnings: [
      ...proposal.warnings,
      "Illustrative cost range uses 90–120% of current planning prices, not a supplier guarantee.",
      ...(offers.every((offer) => offer.component.supplierOfferId.startsWith("synthetic-"))
        ? ["Deterministic synthetic offers: these are not live supplier quotes or availability."]
        : []),
    ].slice(0, 64),
    createdAt: now.toISOString(),
    status: "proposed",
    previewSnapshot: snapshot,
    estimatedCostRange: {
      currency: snapshot.price.currency,
      minimumMinor: Math.floor(total * 0.9),
      maximumMinor: Math.ceil(total * 1.2),
    },
    styleCompatibility: `Pace ${candidate.preferences.pace}/100; spend ${candidate.preferences.spend}/100; discovery ${candidate.preferences.discovery}/100; independence ${candidate.preferences.independence}/100; setting ${candidate.preferences.setting}/100. Draft style fit, not a guarantee.`,
    constraintSummary: candidate.constraints
      .filter((constraint) => constraint.status !== "removed")
      .map(
        (constraint) =>
          `${constraint.priority}: ${constraint.statement.slice(0, 850)} — ${constraint.status === "conflicting" ? "conflicting" : "unverified; confirm with sources before booking"}`,
      ),
  });
  // Candidate and public review evidence must appear together, never a partially reviewable proposal.
  await inTransaction(database, async (transaction) => {
    await new ProposalRepository(transaction, () => now).record(context, publicProposal);
    await transaction
      .insertInto("estimateCandidates")
      .values({ proposalId: proposal.id, snapshot: candidate })
      .onConflict((conflict) => conflict.column("proposalId").doNothing())
      .execute();
  });
  return publicProposal;
}

export const acceptEstimateSchema = z
  .object({ requestId: z.uuid(), expectedVersion: z.number().int().positive() })
  .strict();
export async function acceptEstimate(
  database: Kysely<Database>,
  userId: string,
  tripId: string,
  proposalId: string,
  raw: unknown,
) {
  const input = acceptEstimateSchema.parse(raw);
  return inTransaction(database, async (transaction) => {
    // Same lock order as proposal recording: trip, proposal, then the sole commit boundary.
    const trip = await transaction
      .selectFrom("trips")
      .selectAll()
      .where("id", "=", tripId)
      .where("ownerUserId", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (!trip)
      throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
    const row = await transaction
      .selectFrom("changeProposals")
      .selectAll()
      .where("id", "=", proposalId)
      .where("tripId", "=", tripId)
      .forUpdate()
      .executeTakeFirst();
    const candidate = await transaction
      .selectFrom("estimateCandidates")
      .select("snapshot")
      .where("proposalId", "=", proposalId)
      .executeTakeFirst();
    if (!row || !candidate || row.purpose !== "initial_estimate") runConflict();
    if (input.expectedVersion !== row.baseTripVersion) runConflict();
    const base = await readOwnedTripVersion(transaction, userId, tripId, row.baseTripVersion);
    const snapshot = tripSnapshotSchema.parse(candidate.snapshot);
    if (row.status !== "applied") {
      if (
        row.status !== "proposed" ||
        row.expiresAt <= new Date() ||
        trip.currentVersion !== input.expectedVersion
      )
        runConflict();
      const run = await transaction
        .selectFrom("agentRuns")
        .select(["status", "result", "resultCursor", "eventCursor", "resultFingerprint"])
        .where("id", "=", row.agentRunId)
        .where("ownerUserId", "=", userId)
        .executeTakeFirst();
      const resultProposal = run?.result?.proposal as Record<string, unknown> | undefined;
      if (
        !run ||
        run.status !== "proposed" ||
        run.result?.kind !== "proposal" ||
        resultProposal?.id !== proposalId ||
        run.resultCursor !== run.eventCursor ||
        !run.resultFingerprint
      )
        runConflict();
      if (
        snapshot.components.some(
          (component) =>
            component.offerStatus !== "available" ||
            component.bookingStatus !== "unbooked" ||
            [component.expiresAt, component.price.expiresAt].some(
              (expiry) => expiry !== null && Date.parse(expiry) <= Date.now(),
            ),
        )
      ) {
        throw new ProblemError({
          title: "Estimate offer expired",
          status: 409,
          code: "offer_expired",
        });
      }
      await transaction
        .updateTable("changeProposals")
        .set({ status: "accepted" })
        .where("id", "=", proposalId)
        .execute();
    }
    // Reversal records a validated draft root replacement; booking workflows remain unavailable.
    const applied =
      row.appliedVersion === null
        ? null
        : await transaction
            .selectFrom("tripVersions")
            .select("changeSummary")
            .where("tripId", "=", tripId)
            .where("version", "=", row.appliedVersion)
            .executeTakeFirst();
    const receipt = await commitTripMutation(transaction, {
      tripId,
      ownerUserId: userId,
      expectedVersion: input.expectedVersion,
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      requestFingerprint: fingerprint({ proposalId, ...input }),
      snapshot,
      initiatingActor: "agent_proposal",
      proposalId,
      changeSummary:
        applied?.changeSummary ??
        summarizeTripChanges(tripSnapshotSchema.parse(base.snapshot), snapshot),
      inverseOperation: { operation: "replace", target: "/", value: base.snapshot },
      nonReversibleReason: null,
      outboxEventId: randomUUID(),
      auditEventId: randomUUID(),
    });
    if (row.status !== "applied")
      await transaction
        .updateTable("changeProposals")
        .set({ status: "applied", appliedVersion: receipt.version })
        .where("id", "=", proposalId)
        .execute();
    return {
      ...(await readTrip(transaction, userId, tripId, { version: receipt.version })),
      lifecycleState: "draft" as const,
    };
  });
}
