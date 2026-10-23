// @vitest-environment node
import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { createTrip } from "../../domain/trip/create";
import { readTrip } from "../../domain/trip/read";
import { previewEdit, applyEdit, researchDraftImpact } from "../../domain/trip/edit";
import { undoDraft } from "../../domain/trip/undo";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createPlanningProviders } from "../../server/supply/providers";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

vi.mock("server-only", () => ({}));

describe("read-only refinement repricing", () => {
  it("recalculates party offers and customer totals without mutating its base", async () => {
    const base = createSyntheticTripSnapshot(),
      prior = structuredClone(base);
    const review = await researchDraftImpact(
      base,
      1,
      [{ operation: "replace", target: "/travellerParty/adults", value: 3 }],
      createPlanningProviders("deterministic"),
    );
    expect(base).toEqual(prior);
    expect(review.snapshot.travellerParty.adults).toBe(3);
    expect(review.snapshot.components.length).toBeGreaterThan(0);
    expect(new Set(review.snapshot.components.map((entry) => entry.type))).toEqual(
      new Set(["flight", "accommodation", "activity"]),
    );
    expect(new Set(review.snapshot.components.map((entry) => entry.provider))).toEqual(
      new Set(["duffel", "nuitee", "viator"]),
    );
    expect(review.snapshot.price.finalCustomerTotal.minorUnits).toBe(
      review.snapshot.components.reduce(
        (sum, entry) => sum + entry.price.finalCustomerAmount.minorUnits,
        0,
      ),
    );
    expect(JSON.stringify(review.previewSnapshot)).not.toMatch(/supplierAmount|platformMargin/);
  });
  it("fails closed on missing research and invalid availability instead of publishing a false zero estimate", async () => {
    await expect(
      researchDraftImpact(
        createSyntheticTripSnapshot(),
        1,
        [{ operation: "replace", target: "/travellerParty/adults", value: 3 }],
        [],
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      researchDraftImpact(
        createSyntheticTripSnapshot(),
        1,
        [{ operation: "replace", target: "/duration/maximumDays", value: 30 }],
        [],
      ),
    ).rejects.toThrow();
  });
  it("reviews a confirmed origin change with refreshed unbooked transport and stay prices", async () => {
    const base = createSyntheticTripSnapshot();
    const departureOrigin = {
      kind: "city",
      placeId: "synthetic-new-york",
      name: "New York",
      countryCode: "US",
      timezone: "America/New_York",
      airportCode: null,
      confirmedByUser: true,
    };
    const review = await researchDraftImpact(
      base,
      1,
      [{ operation: "replace", target: "/departureOrigin", value: departureOrigin }],
      createPlanningProviders("deterministic"),
    );
    expect(review.snapshot.departureOrigin).toEqual(departureOrigin);
    expect(base.departureOrigin.name).toBe("Synthetic London Airport");
    expect(review.snapshot.components.some((entry) => entry.type === "flight")).toBe(true);
    expect(review.snapshot.components.some((entry) => entry.type === "accommodation")).toBe(true);
    expect(review.snapshot.components.every((entry) => entry.bookingStatus === "unbooked")).toBe(
      true,
    );
    expect(review.affectedFacts).toContain("price");
  });
});

describe.skipIf(!hasIsolatedDatabaseConfiguration())("atomic reviewed edit and undo", () => {
  it("commits direct edits without a review, expires old estimates, and safely replays", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const userId = randomUUID();
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic',${`${userId}@example.invalid`})`.execute(
        database,
      );
      const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
      snapshot.itineraryDays = [];
      const trip = await createTrip(database, userId, {
        requestId: randomUUID(),
        title: "Direct edit",
        currency: "GBP",
        snapshot,
      });
      const command = {
        requestId: randomUUID(),
        expectedVersion: 1,
        operations: [{ operation: "replace", target: "/preferences/pace", value: 67 }],
      };
      const saved = await applyEdit(database, userId, trip.tripId, command);
      expect(saved.version).toBe(2);
      expect(saved.snapshot.preferences.pace).toBe(67);
      expect(saved.snapshot.price.status).toBe("expired");
      expect((await applyEdit(database, userId, trip.tripId, command)).version).toBe(2);
      expect(
        await database
          .selectFrom("draftEditReviews")
          .select("id")
          .where("tripId", "=", trip.tripId)
          .execute(),
      ).toEqual([]);
      await expect(
        applyEdit(database, userId, trip.tripId, { ...command, requestId: randomUUID() }),
      ).rejects.toThrow();
      await expect(
        applyEdit(database, userId, trip.tripId, {
          ...command,
          operations: [{ operation: "replace", target: "/preferences/pace", value: 80 }],
        }),
      ).rejects.toThrow();
      const restored = await undoDraft(database, userId, trip.tripId, {
        requestId: randomUUID(),
        expectedVersion: 2,
        restoreVersion: 1,
      });
      expect(restored.snapshot.preferences.pace).toBe(snapshot.preferences.pace);
    });
  });

  it("commits once, rejects a competing reviewed edit, and restores as a new immutable version", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const userId = "10000000-0000-4000-8000-000000000011";
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic','refine@example.invalid')`.execute(
        database,
      );
      const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
      snapshot.itineraryDays = [];
      const trip = await createTrip(database, userId, {
        requestId: randomUUID(),
        title: "Refine",
        currency: "GBP",
        snapshot,
      });
      const commands = [25, 75].map((value) => ({
        requestId: randomUUID(),
        expectedVersion: 1,
        operations: [{ operation: "replace", target: "/preferences/pace", value }],
      }));
      const reviews = await Promise.all(
        commands.map((command) =>
          previewEdit(
            database,
            userId,
            trip.tripId,
            command,
            createPlanningProviders("deterministic"),
          ),
        ),
      );
      const inputs = commands.map((command, index) => ({
        ...command,
        impactFingerprint: reviews[index].impactFingerprint,
      }));
      await expect(
        applyEdit(database, userId, trip.tripId, {
          ...inputs[0],
          impactFingerprint: "0".repeat(64),
        }),
      ).rejects.toMatchObject({ status: 409 });
      const accepted = await Promise.all([
        applyEdit(database, userId, trip.tripId, inputs[0]),
        applyEdit(database, userId, trip.tripId, inputs[0]),
      ]);
      expect(accepted[0]).toEqual(accepted[1]);
      expect(accepted[0].version).toBe(2);
      await expect(applyEdit(database, userId, trip.tripId, inputs[1])).rejects.toMatchObject({
        status: 409,
      });
      const undo = { requestId: randomUUID(), expectedVersion: 2, restoreVersion: 1 };
      const restored = await undoDraft(database, userId, trip.tripId, undo);
      expect(restored.version).toBe(3);
      expect(restored.snapshot).toEqual(trip.snapshot);
      expect(await undoDraft(database, userId, trip.tripId, undo)).toEqual(restored);
      expect((await readTrip(database, userId, trip.tripId)).version).toBe(3);
      expect(
        await database
          .selectFrom("tripVersions")
          .select("version")
          .where("tripId", "=", trip.tripId)
          .execute(),
      ).toHaveLength(3);
      expect(
        await database
          .selectFrom("outboxEvents")
          .select("id")
          .where("aggregateId", "=", trip.tripId)
          .execute(),
      ).toHaveLength(3);
    });
  }, 30000);
});
