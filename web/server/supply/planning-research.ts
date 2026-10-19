import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Kysely, Transaction } from "kysely";
import type { Database } from "@/server/db/database";
import { inTransaction } from "@/server/db/transaction";
import { lockServiceGrant } from "@/server/auth/planning-resource";
import { resolvePlanningActor, planningNotFound } from "@/server/auth/planning-actor";
import { lockPlanningAccess, lockPlanningTrip } from "@/server/db/planning-access";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";
import { readOwnedTripVersion } from "@/domain/trip/read";
import type { SupplierReadiness } from "@/server/config";
import { ProblemError } from "@/server/errors";
import { searchPlanningOffers, supplyReadQuerySchema, SupplyReadError, type SupplyReadProvider } from "./read";
import { isCompletePlanningOffer, normalizePlanningOffer, projectPublicPlanningOffer, type PlanningOffer } from "./offers";

export const researchQuerySchema = z.object({
  componentTypes: z.array(z.enum(["flight", "accommodation", "activity", "rail"])).min(1).max(4)
    .refine((types) => new Set(types).size === types.length).default(["flight", "accommodation", "activity", "rail"]),
  destinationIds: z.array(z.uuid()).min(1).max(8).refine((ids) => new Set(ids).size === ids.length),
  startDate: z.iso.date(), endDate: z.iso.date(), departurePlaceId: z.string().min(1).max(256).optional(),
  requirementIds: z.array(z.string().min(1).max(256)).max(32).default([]),
  propertyTypes: z.array(z.string().min(1).max(200)).max(16).default([]),
}).strict().refine((input) => input.endDate >= input.startDate);
export const offerReferenceSchema = z.object({ offerRef: z.uuid(), revision: z.number().int().positive() }).strict();
export interface ResearchActor {
  userId: string; tripId: string; baseTripVersion: number; requestId?: string;
  identity?: { accountUserId: string | null; guestSessionId: string | null };
}
interface ResearchOptions { signal?: AbortSignal; readiness?: SupplierReadiness }
function requireTime(signal: AbortSignal) {
  if (signal.aborted) throw new ProblemError({ title: "Supplier research deadline elapsed",
    status: 504, code: "supplier_research_deadline" });
}

async function lockResearch(transaction: Transaction<Database>, actor: ResearchActor) {
  if (actor.identity) {
    const principal = await resolvePlanningActor(transaction, actor.userId, actor.identity);
    await lockPlanningAccess(transaction, principal);
    await lockPlanningTrip(transaction, actor.userId, actor.tripId);
  }
  if (actor.requestId) {
    await lockServiceGrant(transaction, { ...actor, requestId: actor.requestId });
    const run = await transaction.selectFrom("agentRuns").selectAll().where("ownerUserId", "=", actor.userId)
      .where("tripId", "=", actor.tripId).where("requestId", "=", actor.requestId).executeTakeFirst();
    if (!run || run.baseTripVersion !== actor.baseTripVersion || !["queued", "running"].includes(run.status)
      || !run.leaseExpiresAt || run.leaseExpiresAt <= new Date()) runConflict();
    return run;
  }
}
async function currentTrip(database: Kysely<Database>, actor: ResearchActor) {
  const trip = await readOwnedTripVersion(database, actor.userId, actor.tripId, actor.baseTripVersion);
  if (trip.currentVersion !== actor.baseTripVersion) runConflict();
  return trip;
}

export async function searchResearch(database: Kysely<Database>, providers: readonly SupplyReadProvider[],
  actor: ResearchActor & { requestId: string }, raw: unknown, options: ResearchOptions = {}) {
  const input = researchQuerySchema.parse(raw);
  const signal = AbortSignal.any([AbortSignal.timeout(12_000), ...(options.signal ? [options.signal] : [])]);
  requireTime(signal);
  const basis = await inTransaction(database, async (transaction) => {
    const run = await lockResearch(transaction, actor);
    if (!run) runConflict();
    const trip = await currentTrip(transaction, actor), snapshot = trip.snapshot;
    if (!input.destinationIds.every((id) => snapshot.destinations.some((place) => place.id === id))
      || !snapshot.availabilityWindows.some((window) => window.startDate <= input.startDate && window.endDate >= input.endDate)
      || input.requirementIds.length) runConflict();
    const departureOrigin = input.departurePlaceId
      ? (snapshot.departureOrigins ?? [snapshot.departureOrigin]).find((origin) => origin.placeId === input.departurePlaceId) : snapshot.departureOrigin;
    if (input.departurePlaceId && !departureOrigin) runConflict();
    const query = supplyReadQuerySchema.parse({ componentTypes: input.componentTypes, currency: snapshot.price.currency,
      destinationIds: input.destinationIds, startDate: input.startDate, endDate: input.endDate, departureOrigin: departureOrigin ?? null,
      destinations: snapshot.destinations.filter((place) => input.destinationIds.includes(place.id)),
      travellerParty: snapshot.travellerParty });
    return { runId: run.id, query };
  });
  // Supplier requests never hold trip/access locks or a database transaction.
  requireTime(signal);
  const filteredAccommodation = input.propertyTypes.length > 0 && input.componentTypes.includes("accommodation");
  const types = basis.query.componentTypes.filter((type) => !filteredAccommodation || type !== "accommodation");
  const result = types.length ? await searchPlanningOffers(providers, { ...basis.query, componentTypes: types }, new Date(),
    { ...options, signal }) : { offers: [], outcomes: [] };
  if (filteredAccommodation) result.outcomes.push({
    provider: "duffel", componentType: "accommodation", status: "unsupported", mode: "unknown",
    safeReason: "Property filtering is not established for this operation.", retryable: false, retryAfterMs: null, unverifiedCount: 0,
  });
  const queryFingerprint = fingerprint({ ...basis.query, propertyTypes: input.propertyTypes, requirementIds: input.requirementIds });
  const offers = result.offers.map((rawOffer) => normalizePlanningOffer({ ...rawOffer, offerRef: randomUUID(), revision: 1,
    sourceMode: result.outcomes.find((source) => source.provider === rawOffer.component.provider
      && source.componentType === rawOffer.component.type)?.mode ?? "unknown",
    queryFingerprint, partyFingerprint: fingerprint(basis.query.travellerParty),
    evidence: { status: "estimated", availability: "available", checkedAt: rawOffer.component.checkedAt, expiresAt: rawOffer.component.expiresAt } }));
  await inTransaction(database, async (transaction) => {
    requireTime(signal);
    await lockResearch(transaction, actor); await currentTrip(transaction, actor);
    for (const offer of offers) await transaction.insertInto("planningOfferRecords").values({
      runId: basis.runId, componentId: offer.component.id, offerRef: offer.offerRef, revision: 1,
      offer: { ...offer }, query: { ...basis.query, componentTypes: [offer.component.type] },
    }).execute();
    requireTime(signal);
    await transaction.updateTable("agentRuns").set({ researchResult: { outcomes: result.outcomes, queryFingerprint,
      offerRefs: z.array(z.uuid()).max(32).parse(offers.map((offer) => offer.offerRef)) } }).where("id", "=", basis.runId).execute();
    requireTime(signal);
  });
  return { offers: offers.map((offer) => projectPublicPlanningOffer(offer)), outcomes: result.outcomes, queryFingerprint };
}

async function evidenceRecord(database: Kysely<Database>, actor: ResearchActor, raw: unknown) {
  const reference = offerReferenceSchema.parse(raw);
  await currentTrip(database, actor);
  const record = await database.selectFrom("planningOfferRecords").innerJoin("agentRuns", "agentRuns.id", "planningOfferRecords.runId")
    .select(["planningOfferRecords.runId", "planningOfferRecords.componentId", "planningOfferRecords.offer",
      "planningOfferRecords.query", "planningOfferRecords.offerRef", "planningOfferRecords.revision",
      "agentRuns.requestId", "agentRuns.planningAccessRevokedAt", "agentRuns.baseTripVersion"])
    .where("planningOfferRecords.offerRef", "=", reference.offerRef).where("planningOfferRecords.revision", "=", reference.revision)
    .where("agentRuns.ownerUserId", "=", actor.userId).where("agentRuns.tripId", "=", actor.tripId).executeTakeFirst();
  if (!record || record.planningAccessRevokedAt || record.baseTripVersion !== actor.baseTripVersion
    || (actor.requestId && record.requestId !== actor.requestId)) planningNotFound();
  return record;
}
export async function readResearchOffer(database: Kysely<Database>, actor: ResearchActor, raw: unknown) {
  return inTransaction(database, async (transaction) => {
    await lockResearch(transaction, actor);
    const record = await evidenceRecord(transaction, actor, raw);
    const offer = normalizePlanningOffer(record.offer);
    return { outcome: offer.component.offerStatus === "expired" ? "expired" : "available", offer: projectPublicPlanningOffer(offer) };
  });
}

function materialFacts(offer: PlanningOffer) {
  const { id: _id, checkedAt: _checked, expiresAt: _expiry, price, ...component } = offer.component;
  void _id; void _checked; void _expiry;
  const { checkedAt: _priceChecked, expiresAt: _priceExpiry, ...amounts } = price;
  void _priceChecked; void _priceExpiry;
  const planningDetails = component.planningDetails ? { ...component.planningDetails, checkedAt: null } : component.planningDetails;
  return { ...component, planningDetails, price: amounts, eligibility: offer.eligibility, occupancy: offer.occupancy,
    accessibility: offer.accessibility, supplierReferences: offer.supplierReferences ?? null };
}
export async function refreshResearchOffer(database: Kysely<Database>, providers: readonly SupplyReadProvider[],
  actor: ResearchActor, raw: unknown, operation: "detail" | "revalidation", options: ResearchOptions = {}) {
  const record = await inTransaction(database, async (transaction) => {
    await lockResearch(transaction, actor);
    return evidenceRecord(transaction, actor, raw);
  });
  const previous = normalizePlanningOffer(record.offer);
  const provider = providers.find((source) => source.capabilities.provider === previous.component.provider
    && source.capabilities.search.includes(previous.component.type));
  const declared = previous.component.type === "activity" ? options.readiness?.viator.products.activity.operations[operation]
    : previous.component.type === "flight" || previous.component.type === "accommodation"
      ? options.readiness?.duffel.products[previous.component.type].operations[operation] : undefined;
  const method = operation === "detail" ? provider?.detail : provider?.revalidate;
  if (!method || (options.readiness?.duffel.mode === "live" && declared?.access !== "verified")) {
    return { outcome: "unsupported", offer: projectPublicPlanningOffer(previous), differences: [] };
  }
  let current: PlanningOffer;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), 8_000);
  const signal = AbortSignal.any([deadline.signal, ...(options.signal ? [options.signal] : [])]);
  let stop: (() => void) | undefined;
  try {
    if (signal.aborted) throw new SupplyReadError("error");
    const interrupted = new Promise<never>((_, reject) => {
      stop = () => reject(new SupplyReadError("error"));
      signal.addEventListener("abort", stop, { once: true });
    });
    current = normalizePlanningOffer(await Promise.race([
      method.call(provider, previous.component.supplierOfferId, supplyReadQuerySchema.parse(record.query), signal), interrupted,
    ]));
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    await readResearchOffer(database, actor, raw);
    return { outcome: error instanceof SupplyReadError && error.status === "unsupported" ? "unsupported" : "unknown",
      offer: projectPublicPlanningOffer(previous), differences: [],
      safeReason: "Current evidence could not be established; prior evidence was not extended." };
  } finally {
    clearTimeout(timer);
    if (stop) signal.removeEventListener("abort", stop);
  }
  if (current.component.provider !== previous.component.provider || current.component.type !== previous.component.type
    || current.component.supplierOfferId !== previous.component.supplierOfferId) {
    await readResearchOffer(database, actor, raw);
    return { outcome: "unknown", offer: projectPublicPlanningOffer(previous), differences: [], safeReason: "Supplier evidence did not match the stored selection." };
  }
  const changed = fingerprint(materialFacts(current)) !== fingerprint(materialFacts(previous));
  const outcome = current.component.offerStatus === "expired" ? "expired" : current.component.offerStatus === "unavailable" ? "unavailable"
    : !isCompletePlanningOffer(current) ? "unknown" : changed ? "changed" : "unchanged";
  const offer = normalizePlanningOffer({ ...current, component: { ...current.component, id: previous.component.id },
    offerRef: record.offerRef, revision: record.revision + 1, sourceMode: previous.sourceMode,
    queryFingerprint: previous.queryFingerprint, partyFingerprint: previous.partyFingerprint,
    evidence: { status: previous.sourceMode === "live" && operation === "revalidation" && outcome !== "unknown" ? "live_revalidated" : "estimated",
      availability: outcome === "unknown" || outcome === "expired" ? "unknown" : outcome === "unavailable" ? "unavailable" : "available",
      checkedAt: current.component.checkedAt, expiresAt: current.component.expiresAt } });
  await inTransaction(database, async (transaction) => {
    await lockResearch(transaction, actor); await currentTrip(transaction, actor);
    await transaction.selectFrom("agentRuns").select("id").where("id", "=", record.runId).forUpdate().executeTakeFirstOrThrow();
    await evidenceRecord(transaction, actor, raw);
    const latest = await transaction.selectFrom("planningOfferRecords").select("revision").where("offerRef", "=", record.offerRef)
      .orderBy("revision", "desc").executeTakeFirstOrThrow();
    if (latest.revision !== record.revision) runConflict();
    await transaction.insertInto("planningOfferRecords").values({ runId: record.runId, componentId: record.componentId,
      offerRef: record.offerRef, revision: offer.revision, offer: { ...offer }, query: record.query }).execute();
  });
  return { outcome, offer: projectPublicPlanningOffer(offer), differences: changed ? ["Supplier material facts changed; compare the new revision before selection."] : [] };
}

export async function listResearch(database: Kysely<Database>, actor: ResearchActor) {
  return inTransaction(database, async (transaction) => {
    await lockResearch(transaction, actor); await currentTrip(transaction, actor);
    const research = await transaction.selectFrom("agentRuns").select(["id", "researchResult"]).where("tripId", "=", actor.tripId)
      .where("ownerUserId", "=", actor.userId).where("baseTripVersion", "=", actor.baseTripVersion)
      .where("planningAccessRevokedAt", "is", null).where("researchResult", "is not", null)
      .orderBy("startedAt", "desc").orderBy("id", "desc").executeTakeFirst();
    if (!research) return { offers: [], tripVersion: actor.baseTripVersion, outcomes: [] };
    const offerRefs = z.array(z.uuid()).max(32).parse(research.researchResult?.offerRefs);
    if (!offerRefs.length) return { offers: [], tripVersion: actor.baseTripVersion, outcomes: research.researchResult?.outcomes ?? [] };
    const rows = await transaction.selectFrom("planningOfferRecords").innerJoin("agentRuns", "agentRuns.id", "planningOfferRecords.runId")
      .select(["planningOfferRecords.offerRef", "planningOfferRecords.revision", "planningOfferRecords.offer"])
      .where("agentRuns.ownerUserId", "=", actor.userId).where("agentRuns.tripId", "=", actor.tripId)
      .where("agentRuns.baseTripVersion", "=", actor.baseTripVersion).where("agentRuns.planningAccessRevokedAt", "is", null)
      .where("agentRuns.id", "=", research.id)
      .where("planningOfferRecords.offerRef", "in", offerRefs).distinctOn("planningOfferRecords.offerRef")
      .orderBy("planningOfferRecords.offerRef").orderBy("planningOfferRecords.revision", "desc").limit(32).execute();
    const latest = new Map<string, ReturnType<typeof projectPublicPlanningOffer>>();
    for (const row of rows) if (!latest.has(row.offerRef)) latest.set(row.offerRef, projectPublicPlanningOffer(row.offer));
    return { offers: offerRefs.map((reference) => {
      const offer = latest.get(reference);
      if (!offer) planningNotFound();
      return offer;
    }), tripVersion: actor.baseTripVersion, outcomes: research.researchResult?.outcomes ?? [] };
  });
}

export async function researchCapabilities(database: Kysely<Database>, providers: readonly SupplyReadProvider[],
  readiness: SupplierReadiness, actor: ResearchActor, componentTypes?: string[]) {
  const types = z.array(z.enum(["flight", "accommodation", "activity", "rail"])).min(1).max(4)
    .refine((items) => new Set(items).size === items.length).parse(componentTypes ?? ["flight", "accommodation", "activity", "rail"]);
  await inTransaction(database, async (transaction) => { await lockResearch(transaction, actor); await currentTrip(transaction, actor); });
  const capabilities = types.map((componentType) => {
    if (componentType === "rail") return { provider: null, componentType, mode: "unknown", operations: {
      search: { support: "unsupported", access: "blocked", safeReason: "Rail inventory is deferred; no replacement is configured." },
      detail: { support: "unsupported", access: "blocked" }, revalidation: { support: "unsupported", access: "blocked" },
    }, propertyTypes: null, coverage: null, rateLimit: null, sourceDeadlineMs: 8_000 };
    const declared = componentType === "activity" ? readiness.viator : readiness.duffel;
    const product = componentType === "activity" ? readiness.viator.products.activity : readiness.duffel.products[componentType];
    const source = providers.find((provider) => provider.capabilities.provider === declared.provider && provider.capabilities.search.includes(componentType));
    const operations = Object.fromEntries((["search", "detail", "revalidation"] as const).map((operation) => {
      if (declared.mode === "deterministic") {
        const supported = operation === "search" ? Boolean(source) : operation === "detail" ? Boolean(source?.detail) : Boolean(source?.revalidate);
        return [operation, { support: supported ? "supported" : "unsupported", access: supported ? "configured_unverified" : "blocked",
          safeReason: "Demonstration evidence only; live inventory and booking are not verified.", verifiedAt: null }];
      }
      return [operation, product.operations[operation]];
    }));
    return { provider: declared.provider, componentType, mode: declared.mode, operations,
      propertyTypes: null, coverage: null, rateLimit: null, sourceDeadlineMs: 8_000 };
  });
  return { capabilities, readOnly: true, maximumOffers: 32, overallDeadlineMs: 12_000 };
}
