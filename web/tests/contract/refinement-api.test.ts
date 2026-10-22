// @vitest-environment node
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { sql } from "kysely";
import { vi } from "vitest";

import { previewDraftEdit } from "../../domain/trip/impact";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { createTrip } from "../../domain/trip/create";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { RunRepository } from "../../server/agent-client/run-repository";
import { recordRefinement } from "../../domain/trip/refinement";
import { acceptProposal, rejectProposal } from "../../domain/trip/accept-proposal";
import { readTrip } from "../../domain/trip/read";
import { createPlanningProviders } from "../../server/supply/providers";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

vi.mock("server-only", () => ({}));

describe("reviewed draft impacts", () => {
  it("keeps the input immutable and binds review to operations and version", () => {
    const snapshot = createSyntheticTripSnapshot(),
      before = structuredClone(snapshot);
    const operations = [{ operation: "replace", target: "/preferences/pace", value: 25 }];
    const review = previewDraftEdit(snapshot, 2, operations);
    expect(snapshot).toEqual(before);
    expect(review.snapshot.preferences.pace).toBe(25);
    expect(review.fingerprint).not.toBe(previewDraftEdit(snapshot, 3, operations).fingerprint);
    expect(review.fingerprint).not.toBe(
      previewDraftEdit(snapshot, 2, [{ ...operations[0], value: 30 }]).fingerprint,
    );
  });
  it("rejects transactional paths and protected base bookings", () => {
    const snapshot = createSyntheticTripSnapshot();
    expect(() =>
      previewDraftEdit(snapshot, 1, [{ operation: "replace", target: "/price", value: {} }]),
    ).toThrow();
    expect(() =>
      previewDraftEdit(snapshot, 1, [
        { operation: "replace", target: "/travellerParty/adults", value: 0 },
      ]),
    ).toThrow();
  });
});

describe.skipIf(!hasIsolatedDatabaseConfiguration())(
  "durable refinement proposal contracts",
  () => {
    it("requires persisted results, enforces owner/base/request identity, and replays acceptance exactly", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const userId = "10000000-0000-4000-8000-000000000011";
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic','refine-contract@example.invalid')`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const trip = await createTrip(database, userId, {
          requestId: randomUUID(),
          title: "Refinement contract",
          currency: "GBP",
          snapshot,
        });
        const runs = new RunRepository(database),
          context = { userId, tripId: trip.tripId, requestId: randomUUID(), baseTripVersion: 1 };
        const run = await runs.reserve({
          ...context,
          purpose: "refinement",
          message: "Set pace to 25",
        });
        const proposal = {
          id: randomUUID(),
          purpose: "refinement" as const,
          initiatingRequestId: context.requestId,
          baseTripVersion: 1,
          operations: [{ operation: "replace" as const, target: "/preferences/pace", value: 25 }],
          affectedFacts: ["preferences"],
          rationale: "A slower pace",
          tradeoffs: [],
          warnings: [],
          expiresAt: new Date(Date.now() + 900000).toISOString(),
        };
        await runs.event(context, run.id, 1, {
          version: "1",
          ...context,
          event: {
            version: "1",
            runId: run.id,
            cursor: 1,
            occurredAt: new Date().toISOString(),
            type: "proposal",
            proposal,
          },
        });
        await expect(
          recordRefinement(
            database,
            context,
            run.id,
            { ...proposal, initiatingRequestId: randomUUID() },
            createPlanningProviders("deterministic"),
          ),
        ).rejects.toMatchObject({ status: 409 });
        const saved = await recordRefinement(
          database,
          context,
          run.id,
          proposal,
          createPlanningProviders("deterministic"),
        );
        expect(saved.priceImpact).toBeDefined();
        expect(saved.scheduleImpact).toBeDefined();
        const command = { requestId: randomUUID(), expectedVersion: 1 };
        await expect(
          acceptProposal(database, userId, trip.tripId, proposal.id, command),
        ).rejects.toMatchObject({ status: 409 });
        await runs.result(context, run.id, {
          version: "1",
          ...context,
          eventCursor: 1,
          status: "proposed",
          result: { kind: "proposal", message: "Review", proposal },
        });
        await expect(
          acceptProposal(database, "other-owner", trip.tripId, proposal.id, command),
        ).rejects.toMatchObject({ status: 404 });
        const accepted = await Promise.all([
          acceptProposal(database, userId, trip.tripId, proposal.id, command),
          acceptProposal(database, userId, trip.tripId, proposal.id, command),
        ]);
        expect(accepted[0]).toEqual(accepted[1]);
        expect(accepted[0].version).toBe(2);
        expect((await readTrip(database, userId, trip.tripId)).snapshot.preferences.pace).toBe(25);
        await expect(
          rejectProposal(database, userId, trip.tripId, proposal.id, {
            requestId: randomUUID(),
            expectedVersion: 1,
          }),
        ).rejects.toMatchObject({ status: 409 });
      });
    }, 30000);
  },
);
