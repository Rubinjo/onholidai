// @vitest-environment node
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { createTrip } from "../../domain/trip/create";
import { readTrip } from "../../domain/trip/read";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { RunRepository } from "../../server/agent-client/run-repository";
import { acceptEstimate, recordEstimate } from "../../domain/trip/apply-estimate";
import { createDuffelReadProvider } from "../../server/supply/providers/duffel-read";
import { createBookingReadProvider } from "../../server/supply/providers/booking-read";
import { syntheticReadClient } from "../../server/supply/providers/synthetic";
import { searchPlanningOffers } from "../../server/supply/read";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

vi.mock("server-only", () => ({}));
if (process.env.CI && !hasIsolatedDatabaseConfiguration()) throw new Error("US1 requires database test credentials");
describe.skipIf(!hasIsolatedDatabaseConfiguration())("durable estimate research", () => {
  it("persists a priced proposal without mutation, then commits exactly once on concurrent explicit acceptance", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const userId = "10000000-0000-4000-8000-000000000011";
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic','accept@example.invalid')`.execute(database);
      const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot()); snapshot.itineraryDays = [];
      const trip = await createTrip(database, userId, { requestId: randomUUID(), title: "Accept estimate", currency: "GBP", snapshot });
      const runs = new RunRepository(database), context = { userId, tripId: trip.tripId, requestId: randomUUID(), baseTripVersion: 1 };
      const run = await runs.reserve({ ...context, purpose: "initial_estimate", message: "Estimate reviewed settings" });
      const found = await searchPlanningOffers([createDuffelReadProvider(syntheticReadClient("flight")), createBookingReadProvider(syntheticReadClient("accommodation"))], {
        componentTypes: ["flight", "accommodation"], currency: "GBP", departureOrigin: snapshot.departureOrigin,
        destinationIds: snapshot.destinations.map((destination) => destination.id), startDate: "2030-05-01", endDate: "2030-05-08", travellerParty: snapshot.travellerParty });
      for (const offer of found.offers) await database.insertInto("planningOfferRecords").values({ runId: run.id, componentId: offer.component.id, offer: { ...offer },
        query: { startDate: "2030-05-01", endDate: "2030-05-08", destinationIds: snapshot.destinations.map((destination) => destination.id),
          currency: "GBP", departureOrigin: snapshot.departureOrigin, travellerParty: snapshot.travellerParty } }).execute();
      const components = found.offers.map((offer) => {
        const { price, ...component } = offer.component;
        return { ...component, price: { currency: "GBP", finalCustomerMinor: price.finalCustomerAmount.minorUnits, status: "estimated", checkedAt: price.checkedAt } };
      });
      const proposal = { id: randomUUID(), initiatingRequestId: context.requestId, baseTripVersion: 1, purpose: "initial_estimate" as const,
        operations: [{ operation: "replace" as const, target: "/components", value: components }],
        affectedFacts: ["transport", "price"], rationale: "Synthetic transport estimate; review before applying.", tradeoffs: [], warnings: [],
        expiresAt: new Date(Date.now() + 900000).toISOString() };
      const event = { version: "1" as const, runId: run.id, cursor: 1, occurredAt: new Date().toISOString(), type: "proposal" as const, proposal };
      await runs.event(context, run.id, 1, { version: "1", ...context, event });
      const preview = await recordEstimate(database, context, run.id, proposal);
      expect(preview.previewSnapshot?.price.finalCustomerMinor).toBeGreaterThan(0);
      expect((await readTrip(database, userId, trip.tripId)).version).toBe(1);
      const result = { version: "1", ...context, eventCursor: 1, status: "proposed", result: { kind: "proposal", message: "Review estimate", proposal } };
      await expect(acceptEstimate(database, userId, trip.tripId, proposal.id, { requestId: randomUUID(), expectedVersion: 1 }))
        .rejects.toMatchObject({ status: 409 });
      expect(await runs.result(context, run.id, result)).toEqual(await runs.result(context, run.id, result));
      const command = { requestId: randomUUID(), expectedVersion: 1 };
      const accepted = await Promise.all([acceptEstimate(database, userId, trip.tripId, proposal.id, command), acceptEstimate(database, userId, trip.tripId, proposal.id, command)]);
      expect(accepted[0]).toEqual(accepted[1]); expect(accepted[0].version).toBe(2);
      expect(await database.selectFrom("tripVersions").select("version").where("tripId", "=", trip.tripId).execute()).toHaveLength(2);
      await expect(acceptEstimate(database, "other-owner", trip.tripId, proposal.id, command)).rejects.toMatchObject({ status: 404 });
      await expect(acceptEstimate(database, userId, trip.tripId, proposal.id, { ...command, requestId: randomUUID() })).rejects.toMatchObject({ status: 409 });
    });
  }, 30_000);
  it("reserves before dispatch, replays exact events and rejects gaps without committing a trip", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const userId = "10000000-0000-4000-8000-000000000011";
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic','estimate@example.invalid')`.execute(database);
      const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
      snapshot.itineraryDays = [];
      const trip = await createTrip(database, userId, { requestId: randomUUID(), title: "Estimate", currency: "GBP", snapshot });
      let now = new Date("2030-01-01T00:00:00Z");
      const runs = new RunRepository(database, () => now);
      const context = { userId, tripId: trip.tripId, requestId: randomUUID(), baseTripVersion: 1 };
      const input = { ...context, purpose: "initial_estimate" as const, message: "Estimate my reviewed trip" };
      const reserved = await runs.reserve(input);
      await expect(runs.readScoped({ ...context, tripId: randomUUID() }, reserved.id)).rejects.toMatchObject({ status: 409 });
      expect((await runs.reserve(input)).id).toBe(reserved.id);
      await expect(runs.reserve({ ...input, message: "Changed" })).rejects.toMatchObject({ status: 409 });
      const event = { version: "1" as const, runId: reserved.id, cursor: 1, occurredAt: now.toISOString(),
        type: "progress" as const, stage: "understanding" as const, message: "Reviewing setup" };
      const body = { version: "1" as const, ...context, event };
      expect(await runs.event(context, reserved.id, 1, body)).toEqual(await runs.event(context, reserved.id, 1, body));
      await expect(runs.event(context, reserved.id, 3, { ...body, event: { ...event, cursor: 3 } })).rejects.toMatchObject({ status: 409 });
      await expect(runs.event(context, reserved.id, 1, { ...body, event: { ...event, message: "Changed" } })).rejects.toMatchObject({ status: 409 });
      await expect(runs.result(context, reserved.id, { version: "1", ...context, eventCursor: 1, status: "failed", result: null }))
        .rejects.toMatchObject({ status: 409 });
      expect((await readTrip(database, userId, trip.tripId)).version).toBe(1);
      now = new Date("2030-01-01T00:01:31Z");
      expect((await runs.read(userId, reserved.id)).interruptionReason).toBe("lease_expired");
      expect((await runs.events(userId, reserved.id, 0))).toHaveLength(2);
      await expect(runs.event(context, reserved.id, 2, { ...body, event: { ...event, cursor: 2 } })).rejects.toMatchObject({ status: 409 });
    });
  }, 30_000);
});
