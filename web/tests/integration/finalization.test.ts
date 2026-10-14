// @vitest-environment node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { sql } from "kysely";
import { evaluateFeasibility } from "../../domain/trip/feasibility";
import { qualifiedInstant, requiredArrivalMinutes } from "../../domain/trip/feasibility-policy";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import type { TripSnapshot } from "../../domain/trip/schema";
import { tripSnapshotSchema } from "../../domain/trip/schema";
import { finalizeTrip, reviewFinalization } from "../../domain/trip/finalize";
import { createTrip } from "../../domain/trip/create";
import { commitTripMutation } from "../../domain/trip/commit";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { undoDraft } from "../../domain/trip/undo";
import { componentDetails } from "../../server/supply/directions";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
vi.mock("server-only", () => ({}));

describe("feasibility policy v1", () => {
  it("scores every frozen scheduled item and discloses all concrete hard-conflict cases", async () => {
    const corpus = JSON.parse(await readFile("tests/fixtures/evaluation-corpus.json", "utf8")) as {
      itineraryDays: { input: TripSnapshot; expectedPassingItems: number }[];
      hardConflicts: { input: TripSnapshot; expectedCode: string }[];
    };
    let passing = 0, total = 0;
    for (const entry of corpus.itineraryDays) {
      const report = evaluateFeasibility(entry.input, new Date("2029-01-01T00:00:00Z"));
      expect(report.verifiedItems).toBe(entry.expectedPassingItems);
      passing += report.verifiedItems; total += report.totalItems;
    }
    expect(total).toBe(500); expect(passing).toBeGreaterThanOrEqual(475);
    for (const entry of corpus.hardConflicts) {
      expect(evaluateFeasibility(entry.input).blocking.some((issue) => issue.code === entry.expectedCode)).toBe(true);
    }
  });
  it("rejects ambiguous/nonexistent DST local times and evaluates offsets as instants", () => {
    expect(qualifiedInstant("2030-10-27T01:30", "Europe/London")).toBeNull();
    expect(qualifiedInstant("2030-03-31T01:30", "Europe/London")).toBeNull();
    expect(qualifiedInstant("2030-05-02T10:00", "Europe/Lisbon", "+01:00")).toBe(Date.parse("2030-05-02T09:00Z"));
    expect(requiredArrivalMinutes("flight", true, 210)).toBe(210);
    expect(requiredArrivalMinutes("flight", false)).toBe(120);
    expect(requiredArrivalMinutes("rail")).toBe(30);
  });
  it("never treats missing evidence or constraint ID references as verified", () => {
    const report = evaluateFeasibility(createSyntheticTripSnapshot());
    expect(report.unverified.length).toBeGreaterThan(0);
    expect(report.verifiedItems).toBe(0);
    expect(report.policyVersion).toBe("1");
  });
  it("blocks required early mornings even on mandatory travel days", () => {
    const snapshot = createSyntheticTripSnapshot();
    snapshot.constraints = [{ ...snapshot.constraints[0], category: "schedule", statement: "No activities before 10:00" }];
    const day = snapshot.itineraryDays[0];
    day.mandatoryTravelException = "Mandatory long-distance travel";
    day.items[1].start = day.date + "T09:00";
    expect(evaluateFeasibility(snapshot).blocking.some((issue) => issue.code === "required_schedule")).toBe(true);
  });
  it("blocks dense ordinary days and proposes lower-priority moves without changing choices", () => {
    const snapshot = createSyntheticTripSnapshot();
    snapshot.preferences.pace = 20;
    const day = snapshot.itineraryDays[0];
    day.items = [{ ...day.items[1], id: randomUUID(), start: day.date + "T10:00", end: day.date + "T15:00", priority: "preference" }];
    const before = structuredClone(snapshot);
    const report = evaluateFeasibility(snapshot);
    expect(report.blocking.some((issue) => issue.code === "pace_limit")).toBe(true);
    expect(report.suggestions.some((entry) => entry.itemId === day.items[0].id)).toBe(true);
    expect(snapshot).toEqual(before);
  });
  it("checks sourced transit plus 15 minutes and never verifies unknown travel", () => {
    const snapshot = createSyntheticTripSnapshot(), day = snapshot.itineraryDays[0];
    day.items[1].start = day.date + "T09:00";
    day.items[1].transitionFromPrevious = { durationMinutes: 10, durationUpperBoundMinutes: 20,
      source: "Synthetic directions", checkedAt: "2029-01-01T00:00:00Z", verificationStatus: "verified" };
    day.items[0].location = { latitude: 38.72, longitude: -9.13 };
    expect(evaluateFeasibility(snapshot).blocking.some((issue) => issue.code === "transition_buffer")).toBe(true);
    day.items[1].transitionFromPrevious = undefined;
    expect(evaluateFeasibility(snapshot).unverified.some((issue) => issue.code === "unknown_transit")).toBe(true);
  });
  it("requires nine hours overnight rest, meals and free time and leaves unknown dietary checks disclosed", () => {
    const snapshot = createSyntheticTripSnapshot(), day = snapshot.itineraryDays[0];
    day.items[1].start = day.date + "T20:00"; day.items[1].end = day.date + "T23:00";
    day.items.sort((a, b) => a.start.localeCompare(b.start));
    const nextDay = { ...day, date: "2030-05-03", items: day.items.map((item) => ({ ...item,
      id: randomUUID(), start: item.start.replace(day.date, "2030-05-03"), end: item.end.replace(day.date, "2030-05-03") })) };
    snapshot.itineraryDays.push(nextDay);
    const report = evaluateFeasibility(snapshot);
    expect(report.blocking.some((issue) => issue.code === "overnight_rest")).toBe(false);
    expect(report.blocking.some((issue) => issue.code === "daily_rest")).toBe(true);
    expect(report.unverified.some((issue) => issue.code === "constraint_unverified")).toBe(true);
    nextDay.items[0].start = "2030-05-03T07:00";
    expect(evaluateFeasibility(snapshot).blocking.some((issue) => issue.code === "overnight_rest")).toBe(true);
  });
  it.each([[20, 5, true], [50, 5, false], [80, 7, false], [80, 9, true]] as const)(
    "applies pace %i to %i discretionary hours", (pace, hours, blocked) => {
      const snapshot = createSyntheticTripSnapshot(), day = snapshot.itineraryDays[0]; snapshot.preferences.pace = pace;
      day.items = [{ ...day.items[1], start: day.date + "T10:00", end: day.date + `T${10 + hours}:00` }];
      expect(evaluateFeasibility(snapshot).blocking.some((issue) => issue.code === "pace_limit")).toBe(blocked);
    });
  it("blocks a required hotel-change limit and a supplier-confirmed seasonal closure", () => {
    const snapshot = completePlan(), stay = snapshot.components[0];
    snapshot.constraints = [{ ...createSyntheticTripSnapshot().constraints[0], category: "lodging", statement: "No more than two hotel changes" }];
    snapshot.components = Array.from({ length: 4 }, (_, index) => ({ ...stay, id: randomUUID(), supplierOfferId: `synthetic-hotel-${index}` }));
    expect(evaluateFeasibility(snapshot).blocking.some((issue) => issue.code === "hotel_changes")).toBe(true);
    snapshot.components[0].planningDetails = { ...componentDetails(snapshot.components[0]), availability: "failed" };
    expect(evaluateFeasibility(snapshot).blocking.some((issue) => issue.code === "component_unavailable")).toBe(true);
  });
  it("blocks a verified failure of a required dietary condition", () => {
    const snapshot = createSyntheticTripSnapshot(), meal = snapshot.itineraryDays[0].items[0];
    meal.constraintEvidence = [{ constraintId: snapshot.constraints[0].id, status: "failed", source: "Synthetic menu excludes required diet", checkedAt: "2029-01-01T00:00:00Z" }];
    expect(evaluateFeasibility(snapshot).blocking.some((issue) => issue.code === "required_constraint" && issue.relatedIds.includes(meal.id))).toBe(true);
  });
});

function completePlan(): TripSnapshot {
  const snapshot = createSyntheticTripSnapshot();
  snapshot.constraints = [];
  snapshot.itineraryDays = Array.from({ length: 8 }, (_, index) => {
    const date = `2030-05-${String(index + 1).padStart(2, "0")}`;
    return { date, destinationId: snapshot.destinations[0].id, timezone: "Europe/Lisbon", paceAssessment: 50,
      items: [snapshot.itineraryDays[0].items[0], snapshot.itineraryDays[0].items[1], snapshot.itineraryDays[0].items[2],
        { ...snapshot.itineraryDays[0].items[0], start: "2030-05-02T18:00", end: "2030-05-02T18:45" }]
        .map((item) => ({ ...item, id: randomUUID(), start: item.start.replace("2030-05-02", date), end: item.end.replace("2030-05-02", date),
          location: snapshot.destinations[0].location, constraintChecks: [], verificationStatus: "verified" as const,
          timingEvidence: ["Synthetic fixture evidence"], feasibilityPolicyVersion: "1" as const })) };
  });
  snapshot.components = [{ id: randomUUID(), type: "accommodation", itineraryItemIds: [], provider: "synthetic",
    supplierOfferId: "synthetic-stay", offerStatus: "available", serviceStart: "2030-05-01T14:00:00+01:00", serviceEnd: "2030-05-08T11:00:00+01:00",
    travellerIds: [randomUUID()], bookingRequirements: ["Verify occupancy"], cancellationTerms: "Unverified terms",
    price: { supplierAmount: snapshot.price.supplierTotal, platformMargin: snapshot.price.platformMarginTotal,
      customerPayableTaxes: snapshot.price.customerPayableTaxesTotal, customerPayableFees: snapshot.price.customerPayableFeesTotal,
      finalCustomerAmount: snapshot.price.finalCustomerTotal, source: "synthetic", checkedAt: snapshot.price.checkedAt,
      expiresAt: null, status: "estimated" }, checkedAt: snapshot.price.checkedAt, expiresAt: null, bookingStatus: "unbooked",
    details: { occupancy: "Synthetic 2 adults", amenities: [] } }];
  return tripSnapshotSchema.parse(snapshot);
}

describe.skipIf(!hasIsolatedDatabaseConfiguration())("atomic planning finalization", () => {
  it("binds ownership/version/review, rolls back conflicts, commits once, reloads and undoes without booking", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const userId = randomUUID();
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic',${userId + '@example.invalid'})`.execute(database);
      const publicSnapshot = projectCustomerSnapshot(createSyntheticTripSnapshot()); publicSnapshot.itineraryDays = [];
      const trip = await createTrip(database, userId, { requestId: randomUUID(), title: "Finalize", currency: "GBP", snapshot: publicSnapshot });
      const snapshot = completePlan();
      await commitTripMutation(database, { tripId: trip.tripId, ownerUserId: userId, expectedVersion: 1, requestId: randomUUID(),
        idempotencyKey: randomUUID(), requestFingerprint: "a".repeat(64), snapshot, initiatingActor: "user", proposalId: null,
        changeSummary: ["Synthetic refined fixture"], inverseOperation: { operation: "replace", target: "/", value: snapshot },
        nonReversibleReason: null, outboxEventId: randomUUID(), auditEventId: randomUUID() });
      const review = await reviewFinalization(database, userId, trip.tripId);
      expect(review.report.blocking).toEqual([]); expect(review.report.unverified.length).toBeGreaterThan(0);
      const command = { requestId: randomUUID(), expectedVersion: 2, acknowledgeUnverified: true, reviewFingerprint: review.reviewFingerprint };
      await expect(finalizeTrip(database, randomUUID(), trip.tripId, command)).rejects.toMatchObject({ status: 409 });
      await expect(finalizeTrip(database, userId, trip.tripId, { ...command, expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
      await expect(finalizeTrip(database, userId, trip.tripId, { ...command, acknowledgeUnverified: false })).rejects.toMatchObject({ code: "finalization_blocked" });
      expect((await database.selectFrom("trips").selectAll().where("id", "=", trip.tripId).executeTakeFirstOrThrow()).currentVersion).toBe(2);
      const [first, second] = await Promise.all([finalizeTrip(database, userId, trip.tripId, command), finalizeTrip(database, userId, trip.tripId, command)]);
      expect(first).toEqual(second);
      expect(first).toMatchObject({ version: 3, lifecycleState: "finalized" });
      expect(JSON.stringify(first)).not.toMatch(/supplierAmount|platformMargin/);
      expect(await database.selectFrom("tripVersions").select("version").where("tripId", "=", trip.tripId).execute()).toHaveLength(3);
      const restored = await undoDraft(database, userId, trip.tripId, { requestId: randomUUID(), expectedVersion: 3, restoreVersion: 2 });
      expect(restored).toMatchObject({ version: 4, lifecycleState: "draft" });
      expect(restored.snapshot.components.every((component) => component.bookingStatus === "unbooked")).toBe(true);
    });
  }, 30000);
});
