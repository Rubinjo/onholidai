import "server-only";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { inTransaction } from "@/server/db/transaction";
import { lockServiceGrant } from "@/server/auth/planning-resource";
import { resolvePlanningActor, planningNotFound } from "@/server/auth/planning-actor";
import { lockPlanningAccess, lockPlanningTrip } from "@/server/db/planning-access";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";
import { readOwnedTripVersion } from "@/domain/trip/read";
import { ProblemError } from "@/server/errors";
import { selectedOfferSchema, selectedOffersSchema } from "@/domain/trip/proposal";

import {
  productReadiness,
  readWithRateLimitRetry,
  searchPlanningOffers,
  supplyReadQuerySchema,
  SupplyReadError,
  type SupplyReadProvider,
} from "./read";
import {
  isCompletePlanningOffer,
  normalizePlanningOffer,
  projectPublicPlanningOffer,
  type PlanningOffer,
} from "./offers";

import type { SupplierReadiness } from "@/server/config";
import type { Database } from "@/server/db/database";
import type { Kysely, Transaction } from "kysely";

export const researchQuerySchema = z
  .object({
    componentTypes: z
      .array(z.enum(["flight", "accommodation", "activity", "rail"]))
      .min(1)
      .max(4)
      .refine((types) => new Set(types).size === types.length)
      .default(["flight", "accommodation", "activity", "rail"]),
    destinationIds: z
      .array(z.uuid())
      .min(1)
      .max(8)
      .refine((ids) => new Set(ids).size === ids.length),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    departurePlaceId: z.string().min(1).max(256).optional(),
    requirementIds: z.array(z.string().min(1).max(256)).max(32).default([]),
    propertyTypes: z.array(z.string().min(1).max(200)).max(16).default([]),
  })
  .strict()
  .refine((input) => input.endDate >= input.startDate);
export const offerReferenceSchema = selectedOfferSchema;
export interface ResearchActor {
  userId: string;
  tripId: string;
  baseTripVersion: number;
  requestId?: string;
  identity?: { accountUserId: string | null; guestSessionId: string | null };
}
interface ResearchOptions {
  signal?: AbortSignal;
  readiness?: SupplierReadiness;
}
function requireTime(signal: AbortSignal) {
  if (signal.aborted)
    throw new ProblemError({
      title: "Supplier research deadline elapsed",
      status: 504,
      code: "supplier_research_deadline",
    });
}

async function lockResearch(transaction: Transaction<Database>, actor: ResearchActor) {
  if (actor.identity) {
    const principal = await resolvePlanningActor(transaction, actor.userId, actor.identity);
    await lockPlanningAccess(transaction, principal);
    await lockPlanningTrip(transaction, actor.userId, actor.tripId);
  }
  if (actor.requestId) {
    await lockServiceGrant(transaction, { ...actor, requestId: actor.requestId });
    const run = await transaction
      .selectFrom("agentRuns")
      .selectAll()
      .where("ownerUserId", "=", actor.userId)
      .where("tripId", "=", actor.tripId)
      .where("requestId", "=", actor.requestId)
      .executeTakeFirst();
    if (
      !run ||
      run.baseTripVersion !== actor.baseTripVersion ||
      !["queued", "running"].includes(run.status) ||
      !run.leaseExpiresAt ||
      run.leaseExpiresAt <= new Date()
    )
      runConflict();
    return run;
  }
}
async function currentTrip(database: Kysely<Database>, actor: ResearchActor) {
  const trip = await readOwnedTripVersion(
    database,
    actor.userId,
    actor.tripId,
    actor.baseTripVersion,
  );
  if (trip.currentVersion !== actor.baseTripVersion) runConflict();
  return trip;
}

export async function searchResearch(
  database: Kysely<Database>,
  providers: readonly SupplyReadProvider[],
  actor: ResearchActor & { requestId: string },
  raw: unknown,
  options: ResearchOptions = {},
) {
  const input = researchQuerySchema.parse(raw);
  const signal = AbortSignal.any([
    AbortSignal.timeout(12_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  requireTime(signal);
  const basis = await inTransaction(database, async (transaction) => {
    const run = await lockResearch(transaction, actor);
    if (!run) runConflict();
    const trip = await currentTrip(transaction, actor),
      snapshot = trip.snapshot;
    if (
      !input.destinationIds.every((id) => snapshot.destinations.some((place) => place.id === id)) ||
      !snapshot.availabilityWindows.some(
        (window) => window.startDate <= input.startDate && window.endDate >= input.endDate,
      ) ||
      input.requirementIds.length
    )
      runConflict();
    const departureOrigin = input.departurePlaceId
      ? (snapshot.departureOrigins ?? [snapshot.departureOrigin]).find(
          (origin) => origin.placeId === input.departurePlaceId,
        )
      : snapshot.departureOrigin;
    if (input.departurePlaceId && !departureOrigin) runConflict();
    const query = supplyReadQuerySchema.parse({
      componentTypes: input.componentTypes,
      currency: snapshot.price.currency,
      destinationIds: input.destinationIds,
      startDate: input.startDate,
      endDate: input.endDate,
      departureOrigin: departureOrigin ?? null,
      destinations: snapshot.destinations.filter((place) =>
        input.destinationIds.includes(place.id),
      ),
      travellerParty: snapshot.travellerParty,
    });
    return { runId: run.id, query };
  });
  // Supplier requests never hold trip/access locks or a database transaction.
  requireTime(signal);
  const filteredAccommodation =
    input.propertyTypes.length > 0 && input.componentTypes.includes("accommodation");
  const types = basis.query.componentTypes.filter(
    (type) => !filteredAccommodation || type !== "accommodation",
  );
  const result = types.length
    ? await searchPlanningOffers(providers, { ...basis.query, componentTypes: types }, new Date(), {
        ...options,
        signal,
      })
    : { offers: [], outcomes: [] };
  if (filteredAccommodation)
    result.outcomes.push({
      provider: "nuitee",
      componentType: "accommodation",
      status: "unsupported",
      mode: "unknown",
      safeReason: "Property filtering is not established for this operation.",
      retryable: false,
      retryAfterMs: null,
      unverifiedCount: 0,
    });
  const queryFingerprint = fingerprint({
    ...basis.query,
    propertyTypes: input.propertyTypes,
    requirementIds: input.requirementIds,
  });
  const offers = result.offers.map((rawOffer) =>
    normalizePlanningOffer({
      ...rawOffer,
      offerRef: randomUUID(),
      revision: 1,
      sourceMode:
        result.outcomes.find(
          (source) =>
            source.provider === rawOffer.component.provider &&
            source.componentType === rawOffer.component.type,
        )?.mode ?? "unknown",
      queryFingerprint,
      partyFingerprint: fingerprint(basis.query.travellerParty),
      evidence: {
        status: rawOffer.evidence?.status ?? "estimated",
        availability:
          rawOffer.evidence?.availability ??
          (rawOffer.component.offerStatus === "unavailable" ? "unavailable" : "available"),
        checkedAt: rawOffer.component.checkedAt,
        expiresAt: rawOffer.component.expiresAt,
      },
    }),
  );
  await inTransaction(database, async (transaction) => {
    requireTime(signal);
    await lockResearch(transaction, actor);
    await currentTrip(transaction, actor);
    for (const offer of offers)
      await transaction
        .insertInto("planningOfferRecords")
        .values({
          runId: basis.runId,
          componentId: offer.component.id,
          offerRef: offer.offerRef,
          revision: 1,
          offer: { ...offer },
          query: { ...basis.query, componentTypes: [offer.component.type] },
        })
        .execute();
    requireTime(signal);
    await transaction
      .updateTable("agentRuns")
      .set({
        researchResult: {
          outcomes: result.outcomes,
          queryFingerprint,
          offerRefs: z
            .array(z.uuid())
            .max(32)
            .parse(offers.map((offer) => offer.offerRef)),
        },
      })
      .where("id", "=", basis.runId)
      .execute();
    requireTime(signal);
  });
  return {
    offers: offers.map((offer) => projectPublicPlanningOffer(offer)),
    outcomes: result.outcomes,
    queryFingerprint,
  };
}

async function evidenceRecord(database: Kysely<Database>, actor: ResearchActor, raw: unknown) {
  const reference = offerReferenceSchema.parse(raw);
  await currentTrip(database, actor);
  const record = await database
    .selectFrom("planningOfferRecords")
    .innerJoin("agentRuns", "agentRuns.id", "planningOfferRecords.runId")
    .select([
      "planningOfferRecords.runId",
      "planningOfferRecords.componentId",
      "planningOfferRecords.offer",
      "planningOfferRecords.query",
      "planningOfferRecords.offerRef",
      "planningOfferRecords.revision",
      "agentRuns.requestId",
      "agentRuns.planningAccessRevokedAt",
      "agentRuns.baseTripVersion",
    ])
    .where("planningOfferRecords.offerRef", "=", reference.offerRef)
    .where("planningOfferRecords.revision", "=", reference.revision)
    .where("agentRuns.ownerUserId", "=", actor.userId)
    .where("agentRuns.tripId", "=", actor.tripId)
    .executeTakeFirst();
  if (!record || record.planningAccessRevokedAt || record.baseTripVersion !== actor.baseTripVersion)
    planningNotFound();
  if (actor.requestId && record.requestId !== actor.requestId) {
    const target = await database
      .selectFrom("agentRuns")
      .select(["purpose", "dispatchRequest"])
      .where("ownerUserId", "=", actor.userId)
      .where("tripId", "=", actor.tripId)
      .where("requestId", "=", actor.requestId)
      .executeTakeFirst();
    const grants = target?.dispatchRequest?.selectedOffers;
    if (
      target?.purpose !== "refinement" ||
      !grants ||
      !selectedOffersSchema
        .parse(grants)
        .some(
          (grant) => grant.offerRef === reference.offerRef && grant.revision === reference.revision,
        )
    )
      planningNotFound();
  }
  return record;
}

export async function selectedResearchRecords(
  database: Kysely<Database>,
  actor: ResearchActor,
  raw: unknown,
  now = new Date(),
) {
  const references = selectedOffersSchema.parse(raw);
  const trip = await currentTrip(database, actor);
  const records = [];
  for (const reference of references) {
    const record = await evidenceRecord(database, { ...actor, requestId: undefined }, reference);
    const source = await database
      .selectFrom("agentRuns")
      .select(["purpose", "status"])
      .where("id", "=", record.runId)
      .executeTakeFirstOrThrow();
    const latest = await database
      .selectFrom("planningOfferRecords")
      .select("revision")
      .where("offerRef", "=", reference.offerRef)
      .orderBy("revision", "desc")
      .executeTakeFirstOrThrow();
    const offer = normalizePlanningOffer(record.offer, now);
    const query = record.query;
    const destinations = trip.snapshot.destinations.filter(
      (place) => Array.isArray(query.destinationIds) && query.destinationIds.includes(place.id),
    );
    const starts = destinations
      .map((place) => place.arrivalDate)
      .filter((date) => date !== null)
      .sort();
    const ends = destinations
      .map((place) => place.departureDate)
      .filter((date) => date !== null)
      .sort();
    if (
      source.purpose !== "supplier_research" ||
      source.status !== "completed" ||
      latest.revision !== reference.revision ||
      offer.evidence?.status === "expired" ||
      offer.evidence?.availability === "unavailable" ||
      !["duffel:flight", "nuitee:accommodation", "viator:activity"].includes(
        `${offer.component.provider}:${offer.component.type}`,
      ) ||
      query.currency !== trip.snapshot.price.currency ||
      fingerprint(query.travellerParty) !== fingerprint(trip.snapshot.travellerParty) ||
      fingerprint(query.departureOrigin) !== fingerprint(trip.snapshot.departureOrigin) ||
      query.startDate !== starts[0] ||
      query.endDate !== ends.at(-1) ||
      !Array.isArray(query.destinationIds) ||
      !query.destinationIds.every((id) =>
        trip.snapshot.destinations.some((place) => place.id === id),
      )
    )
      runConflict();
    records.push({ ...record, normalizedOffer: offer });
  }
  return records;
}

export async function selectedRunOffers(
  database: Kysely<Database>,
  actor: ResearchActor & { requestId: string },
  runId: string,
) {
  const run = await database
    .selectFrom("agentRuns")
    .select(["dispatchRequest", "purpose", "status", "leaseExpiresAt", "planningAccessRevokedAt"])
    .where("id", "=", runId)
    .where("ownerUserId", "=", actor.userId)
    .where("tripId", "=", actor.tripId)
    .where("requestId", "=", actor.requestId)
    .executeTakeFirst();
  if (!run || run.planningAccessRevokedAt || run.purpose !== "refinement") runConflict();
  if (!run.dispatchRequest?.selectedOffers) return [];
  return selectedResearchRecords(database, actor, run.dispatchRequest.selectedOffers);
}
export async function readResearchOffer(
  database: Kysely<Database>,
  actor: ResearchActor,
  raw: unknown,
) {
  return inTransaction(database, async (transaction) => {
    await lockResearch(transaction, actor);
    const record = await evidenceRecord(transaction, actor, raw);
    const offer = normalizePlanningOffer(record.offer);
    return {
      outcome:
        offer.component.offerStatus === "expired"
          ? "expired"
          : offer.component.offerStatus === "unavailable"
            ? "unavailable"
            : (offer.evidence?.availability ?? "unknown"),
      offer: projectPublicPlanningOffer(offer),
    };
  });
}

function materialFacts(offer: PlanningOffer) {
  const { id: _id, checkedAt: _checked, expiresAt: _expiry, price, ...component } = offer.component;
  void _id;
  void _checked;
  void _expiry;
  const { checkedAt: _priceChecked, expiresAt: _priceExpiry, ...amounts } = price;
  void _priceChecked;
  void _priceExpiry;
  const planningDetails = component.planningDetails
    ? { ...component.planningDetails, checkedAt: null }
    : component.planningDetails;
  return {
    ...component,
    planningDetails,
    price: amounts,
    eligibility: offer.eligibility,
    occupancy: offer.occupancy,
    accessibility: offer.accessibility,
    supplierReferences: offer.supplierReferences ?? null,
  };
}
export async function refreshResearchOffer(
  database: Kysely<Database>,
  providers: readonly SupplyReadProvider[],
  actor: ResearchActor,
  raw: unknown,
  operation: "detail" | "revalidation",
  options: ResearchOptions = {},
) {
  const requestSignal = AbortSignal.any([
    AbortSignal.timeout(12_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  requireTime(requestSignal);
  const record = await inTransaction(database, async (transaction) => {
    await lockResearch(transaction, actor);
    const record = await evidenceRecord(transaction, actor, raw);
    requireTime(requestSignal);
    const latest = await transaction
      .selectFrom("planningOfferRecords")
      .select("revision")
      .where("offerRef", "=", record.offerRef)
      .orderBy("revision", "desc")
      .executeTakeFirstOrThrow();
    if (latest.revision !== record.revision) runConflict();
    return record;
  });
  requireTime(requestSignal);
  const previous = normalizePlanningOffer(record.offer);
  const provider = providers.find(
    (source) =>
      source.capabilities.provider === previous.component.provider &&
      source.capabilities.search.includes(previous.component.type) &&
      !(previous.component.provider === "duffel" && previous.component.type === "accommodation"),
  );
  const declared = productReadiness(options.readiness, previous.component.type, operation);
  const method = operation === "detail" ? provider?.detail : provider?.revalidate;
  const implementation = provider?.capabilities.operations?.[operation];
  if (
    !method ||
    implementation === "unsupported" ||
    declared?.operation.support === "unsupported"
  ) {
    return {
      outcome: "unsupported",
      offer: projectPublicPlanningOffer(previous),
      differences: [],
      safeReason: "This supplier product does not support the requested read operation.",
    };
  }
  if (
    implementation === "unknown" ||
    declared?.operation.access === "blocked" ||
    (declared?.mode === "live" &&
      (declared.operation.support !== "supported" || declared.operation.access !== "verified"))
  ) {
    return {
      outcome: "unknown",
      offer: projectPublicPlanningOffer(previous),
      differences: [],
      safeReason:
        "This supplier product's read access is not verified; prior evidence was not extended.",
    };
  }
  let current: PlanningOffer;
  const deadline = new AbortController();
  const deadlineAt = Date.now() + 8_000;
  const timer = setTimeout(() => deadline.abort(), 8_000);
  const signal = AbortSignal.any([deadline.signal, requestSignal]);
  let stop: (() => void) | undefined;
  try {
    if (signal.aborted) throw new SupplyReadError("error");
    const interrupted = new Promise<never>((_, reject) => {
      stop = () => reject(new SupplyReadError("error"));
      signal.addEventListener("abort", stop, { once: true });
    });
    current = normalizePlanningOffer(
      await Promise.race([
        readWithRateLimitRetry(
          () =>
            method.call(
              provider,
              previous.component.supplierOfferId,
              supplyReadQuerySchema.parse(record.query),
              signal,
            ),
          signal,
          deadlineAt,
        ),
        interrupted,
      ]),
    );
  } catch (error) {
    requireTime(requestSignal);
    if (!(error instanceof Error)) throw error;
    await readResearchOffer(database, actor, raw);
    requireTime(requestSignal);
    return {
      outcome:
        error instanceof SupplyReadError && error.status === "unsupported"
          ? "unsupported"
          : "unknown",
      offer: projectPublicPlanningOffer(previous),
      differences: [],
      safeReason: "Current evidence could not be established; prior evidence was not extended.",
    };
  } finally {
    clearTimeout(timer);
    if (stop) signal.removeEventListener("abort", stop);
  }
  requireTime(requestSignal);
  if (
    current.component.provider !== previous.component.provider ||
    current.component.type !== previous.component.type ||
    current.component.supplierOfferId !== previous.component.supplierOfferId
  ) {
    await readResearchOffer(database, actor, raw);
    requireTime(requestSignal);
    return {
      outcome: "unknown",
      offer: projectPublicPlanningOffer(previous),
      differences: [],
      safeReason: "Supplier evidence did not match the stored selection.",
    };
  }
  const changed = fingerprint(materialFacts(current)) !== fingerprint(materialFacts(previous));
  const outcome =
    current.component.offerStatus === "expired"
      ? "expired"
      : current.component.offerStatus === "unavailable"
        ? "unavailable"
        : current.evidence?.availability === "unknown" || !isCompletePlanningOffer(current)
          ? "unknown"
          : changed
            ? "changed"
            : "unchanged";
  const offer = normalizePlanningOffer({
    ...current,
    component: { ...current.component, id: previous.component.id },
    offerRef: record.offerRef,
    revision: record.revision + 1,
    sourceMode: previous.sourceMode,
    queryFingerprint: previous.queryFingerprint,
    partyFingerprint: previous.partyFingerprint,
    evidence: {
      status:
        previous.sourceMode === "live" && operation === "revalidation" && outcome !== "unknown"
          ? "live_revalidated"
          : "estimated",
      availability:
        outcome === "unknown" || outcome === "expired"
          ? "unknown"
          : outcome === "unavailable"
            ? "unavailable"
            : "available",
      checkedAt: current.component.checkedAt,
      expiresAt: current.component.expiresAt,
    },
  });
  await inTransaction(database, async (transaction) => {
    requireTime(requestSignal);
    await lockResearch(transaction, actor);
    await currentTrip(transaction, actor);
    await transaction
      .selectFrom("agentRuns")
      .select("id")
      .where("id", "=", record.runId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    await evidenceRecord(transaction, actor, raw);
    const latest = await transaction
      .selectFrom("planningOfferRecords")
      .select("revision")
      .where("offerRef", "=", record.offerRef)
      .orderBy("revision", "desc")
      .executeTakeFirstOrThrow();
    requireTime(requestSignal);
    if (latest.revision !== record.revision) runConflict();
    await transaction
      .insertInto("planningOfferRecords")
      .values({
        runId: record.runId,
        componentId: record.componentId,
        offerRef: record.offerRef,
        revision: offer.revision,
        offer: { ...offer },
        query: record.query,
      })
      .execute();
    requireTime(requestSignal);
  });
  return {
    outcome,
    offer: projectPublicPlanningOffer(offer),
    differences: changed
      ? ["Supplier material facts changed; compare the new revision before selection."]
      : [],
  };
}

export async function listResearch(database: Kysely<Database>, actor: ResearchActor) {
  return inTransaction(database, async (transaction) => {
    await lockResearch(transaction, actor);
    await currentTrip(transaction, actor);
    const research = await transaction
      .selectFrom("agentRuns")
      .select(["id", "researchResult"])
      .where("tripId", "=", actor.tripId)
      .where("ownerUserId", "=", actor.userId)
      .where("baseTripVersion", "=", actor.baseTripVersion)
      .where("planningAccessRevokedAt", "is", null)
      .where("researchResult", "is not", null)
      .orderBy("startedAt", "desc")
      .orderBy("id", "desc")
      .executeTakeFirst();
    if (!research) return { offers: [], tripVersion: actor.baseTripVersion, outcomes: [] };
    const offerRefs = z.array(z.uuid()).max(32).parse(research.researchResult?.offerRefs);
    if (!offerRefs.length)
      return {
        offers: [],
        tripVersion: actor.baseTripVersion,
        outcomes: research.researchResult?.outcomes ?? [],
      };
    const rows = await transaction
      .selectFrom("planningOfferRecords")
      .innerJoin("agentRuns", "agentRuns.id", "planningOfferRecords.runId")
      .select([
        "planningOfferRecords.offerRef",
        "planningOfferRecords.revision",
        "planningOfferRecords.offer",
      ])
      .where("agentRuns.ownerUserId", "=", actor.userId)
      .where("agentRuns.tripId", "=", actor.tripId)
      .where("agentRuns.baseTripVersion", "=", actor.baseTripVersion)
      .where("agentRuns.planningAccessRevokedAt", "is", null)
      .where("agentRuns.id", "=", research.id)
      .where("planningOfferRecords.offerRef", "in", offerRefs)
      .distinctOn("planningOfferRecords.offerRef")
      .orderBy("planningOfferRecords.offerRef")
      .orderBy("planningOfferRecords.revision", "desc")
      .limit(32)
      .execute();
    const latest = new Map<string, ReturnType<typeof projectPublicPlanningOffer>>();
    for (const row of rows)
      if (!latest.has(row.offerRef))
        latest.set(row.offerRef, projectPublicPlanningOffer(row.offer));
    return {
      offers: offerRefs.map((reference) => {
        const offer = latest.get(reference);
        if (!offer) planningNotFound();
        return offer;
      }),
      tripVersion: actor.baseTripVersion,
      outcomes: research.researchResult?.outcomes ?? [],
    };
  });
}

export async function researchCapabilities(
  database: Kysely<Database>,
  providers: readonly SupplyReadProvider[],
  readiness: SupplierReadiness,
  actor: ResearchActor,
  componentTypes?: string[],
) {
  const types = z
    .array(z.enum(["flight", "accommodation", "activity", "rail"]))
    .min(1)
    .max(4)
    .refine((items) => new Set(items).size === items.length)
    .parse(componentTypes ?? ["flight", "accommodation", "activity", "rail"]);
  await inTransaction(database, async (transaction) => {
    await lockResearch(transaction, actor);
    await currentTrip(transaction, actor);
  });
  const capabilities = types.map((componentType) => {
    if (componentType === "rail")
      return {
        provider: null,
        componentType,
        mode: "unknown",
        operations: {
          search: {
            support: "unsupported",
            access: "blocked",
            safeReason: "Rail inventory is deferred; no replacement is configured.",
          },
          detail: { support: "unsupported", access: "blocked" },
          revalidation: { support: "unsupported", access: "blocked" },
        },
        propertyTypes: null,
        coverage: null,
        rateLimit: null,
        freshnessMaxAgeMs: null,
        sourceDeadlineMs: 8_000,
        limitations: [
          "Rail is deferred; saved rail confirmations retain their original attribution.",
        ],
      };
    const declared =
      componentType === "activity"
        ? readiness.viator
        : componentType === "accommodation"
          ? readiness.nuitee
          : readiness.duffel;
    const product =
      componentType === "activity"
        ? readiness.viator.products.activity
        : componentType === "accommodation"
          ? readiness.nuitee.products.accommodation
          : readiness.duffel.products.flight;
    const source = providers.find(
      (provider) =>
        provider.capabilities.provider === declared.provider &&
        provider.capabilities.search.includes(componentType),
    );
    const operations = Object.fromEntries(
      (["search", "detail", "revalidation"] as const).map((operation) => {
        const methodExists =
          operation === "search"
            ? Boolean(source)
            : operation === "detail"
              ? Boolean(source?.detail)
              : Boolean(source?.revalidate);
        const implementation = methodExists
          ? (source?.capabilities.operations?.[operation] ?? "supported")
          : "unsupported";
        if (implementation !== "supported")
          return [
            operation,
            {
              support: implementation,
              access: "blocked",
              safeReason: "The configured adapter cannot establish this read operation.",
              verifiedAt: null,
            },
          ];
        if (declared.mode === "deterministic") {
          const configured = product.operations[operation];
          if (configured.support === "unsupported" || configured.access === "blocked")
            return [operation, configured];
          return [
            operation,
            {
              support: "supported",
              access: "configured_unverified",
              safeReason:
                "Demonstration evidence only; live inventory and booking are not verified.",
              verifiedAt: null,
            },
          ];
        }
        return [operation, product.operations[operation]];
      }),
    );
    return {
      provider: declared.provider,
      componentType,
      mode: declared.mode,
      operations,
      propertyTypes: null,
      coverage: null,
      rateLimit: null,
      freshnessMaxAgeMs: null,
      sourceDeadlineMs: 8_000,
      limitations: [
        "Property and requirement filtering are not supported.",
        "Market, party and property coverage and supplier rate limits are not established.",
        "Freshness requires supplier evidence; reads never hold inventory or establish booking access.",
      ],
    };
  });
  return {
    capabilities,
    readOnly: true,
    maximumOffers: 32,
    overallDeadlineMs: 12_000,
    queryLimits: { maximumComponentTypes: 4, maximumDestinations: 8 },
  };
}
