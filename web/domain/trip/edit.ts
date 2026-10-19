import { inTransaction } from "@/server/db/transaction";
import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "@/server/db/database";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";
import { searchPlanningOffers, type SupplyReadProvider } from "@/server/supply/read";
import { isCompletePlanningOffer } from "@/server/supply/offers";
import { projectCustomerSnapshot } from "@/domain/pricing/projections";
import { previewDraftEdit } from "./impact";
import { proposalOperationSchema } from "./proposal";
import { readOwnedTripVersion, readTrip } from "./read";
import { commitTripMutation } from "./commit";
import { priceEstimate } from "./apply-estimate";
import { tripSnapshotSchema, type TripSnapshot } from "./schema";

export const editPreviewSchema = z.object({ requestId: z.uuid(), expectedVersion: z.number().int().positive(), operations: z.array(proposalOperationSchema).min(1).max(32) }).strict();
export const editSchema = editPreviewSchema.extend({ impactFingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() });

export async function researchDraftImpact(base: TripSnapshot, version: number, operations: readonly unknown[], providers: readonly SupplyReadProvider[]) {
  const review = previewDraftEdit(base, version, operations);
  if (review.researchRequired) {
    const candidate = review.snapshot, dates = candidate.destinations.flatMap((destination) => destination.arrivalDate && destination.departureDate ? [destination.arrivalDate, destination.departureDate] : []).sort();
    const startDate = dates[0] ?? candidate.availabilityWindows[0].startDate;
    const endDate = dates.at(-1) ?? new Date(Date.parse(startDate + "T00:00:00Z") + (candidate.duration.idealDays - 1) * 86400000).toISOString().slice(0, 10);
    const found = await searchPlanningOffers(providers, { startDate, endDate, componentTypes: ["flight", "accommodation", "activity", "rail"], currency: candidate.price.currency,
      departureOrigin: candidate.departureOrigin, travellerParty: candidate.travellerParty, destinationIds: candidate.destinations.map((destination) => destination.id) });
    const complete = found.offers.filter(isCompletePlanningOffer);
    const groups = new Map<string, typeof complete>();
    for (const offer of complete) {
      const key = offer.selectionGroup ?? offer.component.type;
      groups.set(key, [...(groups.get(key) ?? []), offer]);
    }
    const selected = [...groups.values()].map((options) => {
      options.sort((a, b) => a.component.price.finalCustomerAmount.minorUnits - b.component.price.finalCustomerAmount.minorUnits);
      return options[Math.floor((options.length - 1) * candidate.preferences.spend / 100)];
    });
    const components = selected.map((offer) => ({ ...offer.component, price: { currency: candidate.price.currency, finalCustomerMinor: offer.component.price.finalCustomerAmount.minorUnits, status: "estimated", checkedAt: offer.component.price.checkedAt } }));
    review.snapshot = priceEstimate(candidate, [{ operation: "replace", target: "/components", value: components }], selected, new Date());
    review.previewSnapshot = projectCustomerSnapshot(review.snapshot);
    review.priceImpact.afterMinor = review.snapshot.price.finalCustomerTotal.minorUnits;
    review.priceImpact.deltaMinor = review.priceImpact.afterMinor - review.priceImpact.beforeMinor;
    review.warnings = ["Repriced from fresh read-only planning offers. Prices and eligibility remain estimated, not confirmed.", "Daily recommendations were cleared because the inputs changed; finalization will rebuild them."];
    if (selected.every((offer) => offer.component.supplierOfferId.startsWith("synthetic-"))) review.warnings.push("Deterministic synthetic offers, not live supplier inventory.");
  }
  review.fingerprint = fingerprint({ version, operations, snapshot: review.snapshot, priceImpact: review.priceImpact, scheduleImpact: review.scheduleImpact, warnings: review.warnings });
  return review;
}

export async function previewEdit(database: Kysely<Database>, userId: string, tripId: string, raw: unknown, providers: readonly SupplyReadProvider[]) {
  const input = editPreviewSchema.parse(raw), base = await readOwnedTripVersion(database, userId, tripId);
  if (base.currentVersion !== input.expectedVersion || base.lifecycleState !== "draft") runConflict();
  const previous = await database.selectFrom("draftEditReviews").selectAll().where("id", "=", input.requestId).where("ownerUserId", "=", userId).executeTakeFirst();
  if (previous) {
    if (previous.tripId !== tripId || previous.baseTripVersion !== input.expectedVersion || fingerprint(previous.operations) !== fingerprint(input.operations)) runConflict();
    return previous.review;
  }
  const { snapshot, researchRequired: _research, ...review } = await researchDraftImpact(tripSnapshotSchema.parse(base.snapshot), input.expectedVersion, input.operations, providers);
  void _research;
  const publicReview = { reviewId: input.requestId, tripId, baseTripVersion: input.expectedVersion, operations: input.operations,
    affectedFacts: review.affectedFacts, previewSnapshot: review.previewSnapshot, impactFingerprint: review.fingerprint, expiresAt: new Date(Date.now() + 900000).toISOString(),
    impacts: {
      route: review.previewSnapshot.destinations.map((entry) => `${entry.routePosition + 1}. ${entry.name}: ${entry.plannedNights} nights`),
      dates: review.scheduleImpact.after.map((entry) => `${entry.arrivalDate} to ${entry.departureDate}`),
      transport: review.previewSnapshot.components.filter((entry) => ["flight", "rail", "transfer"].includes(entry.type)).map((entry) => `${entry.type}: ${entry.serviceStart} to ${entry.serviceEnd}`),
      stays: review.previewSnapshot.components.filter((entry) => entry.type === "accommodation").map((entry) => `${entry.serviceStart} to ${entry.serviceEnd}`),
      activities: review.previewSnapshot.components.filter((entry) => entry.type === "activity").map((entry) => `${entry.serviceStart} to ${entry.serviceEnd}`),
      availability: review.previewSnapshot.availabilityWindows.map((entry) => `${entry.preference}: ${entry.startDate} to ${entry.endDate}`),
      constraints: review.previewSnapshot.constraints.filter((entry) => entry.status !== "removed").map((entry) => `${entry.priority}: ${entry.statement}; ${entry.status}`),
      schedule: review.warnings, price: review.priceImpact,
    } };
  await database.insertInto("draftEditReviews").values({ id: input.requestId, tripId, ownerUserId: userId, baseTripVersion: input.expectedVersion,
    fingerprint: review.fingerprint, operations: sql<unknown[]>`${JSON.stringify(input.operations)}::jsonb`, review: publicReview, snapshot, expiresAt: new Date(publicReview.expiresAt) })
    .onConflict((conflict) => conflict.column("id").doNothing()).execute();
  const stored = await database.selectFrom("draftEditReviews").selectAll().where("id", "=", input.requestId).where("ownerUserId", "=", userId).executeTakeFirstOrThrow();
  if (stored.tripId !== tripId || stored.baseTripVersion !== input.expectedVersion || fingerprint(stored.operations) !== fingerprint(input.operations)) runConflict();
  return stored.review;
}

export async function applyEdit(database: Kysely<Database>, userId: string, tripId: string, raw: unknown) {
  const input = editSchema.parse(raw);
  return inTransaction(database, async (transaction) => {
    const trip = await transaction.selectFrom("trips").selectAll().where("id", "=", tripId).where("ownerUserId", "=", userId).forUpdate().executeTakeFirst();
    if (!trip || trip.lifecycleState !== "draft") runConflict();
    const prior = await transaction.selectFrom("tripVersions").select("version").where("tripId", "=", tripId).where("initiatingRequestId", "=", input.requestId).executeTakeFirst();
    if (!prior && trip.currentVersion !== input.expectedVersion) runConflict();
    const base = await readOwnedTripVersion(transaction, userId, tripId, input.expectedVersion);
    if (base.snapshot.components.some((component) => component.bookingStatus !== "unbooked")) runConflict();
    let snapshot: TripSnapshot;
    let affectedFacts: string[];
    if (input.impactFingerprint !== undefined) {
      const review = await transaction.selectFrom("draftEditReviews").selectAll().where("id", "=", input.requestId).where("tripId", "=", tripId).where("ownerUserId", "=", userId).executeTakeFirst();
      if (!review || review.baseTripVersion !== input.expectedVersion || review.fingerprint !== input.impactFingerprint || fingerprint(review.operations) !== fingerprint(input.operations)) runConflict();
      if (!prior && review.expiresAt.getTime() <= Date.now()) runConflict();
      if (!prior && review.snapshot.components.some((component) => component.offerStatus !== "available" || [component.expiresAt, component.price.expiresAt].some((expiry) => expiry && Date.parse(expiry) <= Date.now()))) runConflict();
      snapshot = tripSnapshotSchema.parse(review.snapshot);
      affectedFacts = z.array(z.string()).parse(review.review.affectedFacts);
    } else {
      const change = previewDraftEdit(tripSnapshotSchema.parse(base.snapshot), input.expectedVersion, input.operations);
      snapshot = change.snapshot;
      affectedFacts = change.affectedFacts;
    }
    const receipt = await commitTripMutation(transaction, { tripId, ownerUserId: userId, expectedVersion: input.expectedVersion, requestId: input.requestId, idempotencyKey: input.requestId,
      requestFingerprint: fingerprint(input), snapshot, initiatingActor: "user", proposalId: null,
      changeSummary: affectedFacts, inverseOperation: { operation: "replace", target: "/", value: base.snapshot }, nonReversibleReason: null, outboxEventId: randomUUID(), auditEventId: randomUUID() });
    return readTrip(transaction, userId, tripId, { version: receipt.version });
  });
}
