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
import {
  searchResearch,
  readResearchOffer,
  refreshResearchOffer,
} from "../../server/supply/planning-research";
import { undoDraft } from "../../domain/trip/undo";
import { planningOfferSchema } from "../../server/supply/offers";

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
    it.each(["manual", "automatic", "changed-revision"] as const)(
      "imports only current selected research into a %s run and materializes trusted prices",
      async (scenario) => {
        const applicationPolicy = scenario === "automatic" ? "automatic" : "manual";
        await withIsolatedTestDatabase(async ({ database }) => {
          const userId = randomUUID();
          await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic',${userId + "@example.invalid"})`.execute(
            database,
          );
          const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
          snapshot.itineraryDays = [];
          snapshot.constraints = [];
          const trip = await createTrip(database, userId, {
            requestId: randomUUID(),
            title: "Selected research",
            currency: "GBP",
            snapshot,
          });
          const providers = createPlanningProviders("deterministic").map((provider) => ({
            ...provider,
            async search(...args: Parameters<typeof provider.search>) {
              return (await provider.search(...args)).map((raw) => {
                const offer = planningOfferSchema.parse(raw);
                offer.occupancy = { maximumAdults: 2, maximumChildren: 0 };
                return offer;
              });
            },
          }));
          const runs = new RunRepository(database);
          const actor = { userId, tripId: trip.tripId, baseTripVersion: 1 };
          const source = await runs.reserve({
            ...actor,
            requestId: randomUUID(),
            purpose: "supplier_research",
            message: "Research",
          });
          const found = await searchResearch(
            database,
            providers,
            { ...actor, requestId: source.requestId },
            {
              componentTypes: ["flight", "accommodation", "activity"],
              destinationIds: snapshot.destinations.map((place) => place.id),
              startDate: "2030-05-01",
              endDate: "2030-05-08",
            },
          );
          await expect(
            runs.reserve({
              ...actor,
              requestId: randomUUID(),
              purpose: "refinement",
              message: "Import unfinished research",
              selectedOffers: [{ offerRef: found.offers[0].offerRef!, revision: 1 }],
            }),
          ).rejects.toMatchObject({ status: 409 });
          const mismatched = await searchResearch(
            database,
            providers,
            { ...actor, requestId: source.requestId },
            {
              componentTypes: ["flight"],
              destinationIds: snapshot.destinations.map((place) => place.id),
              startDate: "2030-05-02",
              endDate: "2030-05-08",
            },
          );
          await runs.event({ ...actor, requestId: source.requestId }, source.id, 1, {
            version: "1",
            ...actor,
            requestId: source.requestId,
            event: {
              version: "1",
              runId: source.id,
              cursor: 1,
              occurredAt: new Date().toISOString(),
              type: "completed",
              status: "completed",
            },
          });
          await runs.result({ ...actor, requestId: source.requestId }, source.id, {
            version: "1",
            ...actor,
            requestId: source.requestId,
            eventCursor: 1,
            status: "completed",
            result: { kind: "answer", message: "Saved synthetic research" },
          });
          const selectedOffers = found.offers.map((offer) => ({
            offerRef: offer.offerRef!,
            revision: offer.revision!,
          }));
          await expect(
            runs.reserve({
              ...actor,
              requestId: randomUUID(),
              purpose: "refinement",
              message: "Import wrong-date research",
              selectedOffers: [{ offerRef: mismatched.offers[0].offerRef!, revision: 1 }],
            }),
          ).rejects.toMatchObject({ status: 409 });
          await expect(
            runs.reserve({
              ...actor,
              requestId: randomUUID(),
              purpose: "initial_estimate",
              message: "Wrong purpose",
              selectedOffers,
            }),
          ).rejects.toThrow();
          const otherTrip = await createTrip(database, userId, {
            requestId: randomUUID(),
            title: "Other private trip",
            currency: "GBP",
            snapshot,
          });
          await expect(
            runs.reserve({
              ...actor,
              tripId: otherTrip.tripId,
              requestId: randomUUID(),
              purpose: "refinement",
              message: "Foreign research",
              selectedOffers,
            }),
          ).rejects.toMatchObject({ status: 404 });
          const unrelated = await runs.reserve({
            ...actor,
            requestId: randomUUID(),
            purpose: "refinement",
            message: "Unrelated planning request",
          });
          await runs.validateDispatch({ ...actor, requestId: unrelated.requestId }, unrelated.id, {
            contractVersion: "1",
            requestId: unrelated.requestId,
            conversationId: unrelated.conversationId,
            actor: { ...actor, scopes: ["trip:read", "proposal:create"] },
            purpose: "refinement",
            message: "Unrelated planning request",
            context: { tripSummary: { version: 1 }, contextBudget: { maximumTokens: 24000 } },
          });
          await expect(
            readResearchOffer(
              database,
              {
                ...actor,
                requestId: unrelated.requestId,
              },
              selectedOffers[0],
            ),
          ).rejects.toMatchObject({ status: 404 });
          const reservation = {
            ...actor,
            requestId: randomUUID(),
            purpose: "refinement" as const,
            message: "Use the selected research",
            applicationPolicy,
            selectedOffers,
          };
          const run = await runs.reserve(reservation);
          const context = { ...actor, requestId: run.requestId };
          await runs.validateDispatch(context, run.id, {
            contractVersion: "1",
            requestId: run.requestId,
            conversationId: run.conversationId,
            actor: { ...actor, scopes: ["trip:read", "proposal:create"] },
            purpose: "refinement",
            message: reservation.message,
            selectedOffers,
            context: { tripSummary: { version: 1 }, contextBudget: { maximumTokens: 24000 } },
          });
          expect(
            (await readResearchOffer(database, context, selectedOffers[0])).offer.offerRef,
          ).toBe(selectedOffers[0].offerRef);
          await expect(
            readResearchOffer(database, { ...context, requestId: randomUUID() }, selectedOffers[0]),
          ).rejects.toThrow();
          const proposal = {
            id: randomUUID(),
            purpose: "refinement" as const,
            initiatingRequestId: run.requestId,
            baseTripVersion: 1,
            operations: [
              {
                operation: "replace" as const,
                target: "/components",
                value: found.offers.map((offer) => ({
                  ...offer.component,
                  price: { ...offer.component.price, finalCustomerMinor: 1 },
                })),
              },
            ],
            affectedFacts: ["components"],
            rationale: "Selected sourced options; unknown facts remain unverified.",
            tradeoffs: [],
            warnings: [],
            expiresAt: new Date(Date.now() + 900000).toISOString(),
          };
          const saved = await recordRefinement(database, context, run.id, proposal, []);
          expect(
            saved.previewSnapshot?.components.map((item) => item.supplierOfferId).sort(),
          ).toEqual(found.offers.map((item) => item.component.supplierOfferId).sort());
          expect(saved.previewSnapshot?.price.finalCustomerMinor).toBeGreaterThan(1);
          expect((await readTrip(database, userId, trip.tripId)).version).toBe(1);
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
          await runs.result(context, run.id, {
            version: "1",
            ...context,
            eventCursor: 1,
            status: "proposed",
            result: { kind: "proposal", message: "Review sourced choices", proposal },
          });
          if (scenario === "changed-revision") {
            const refreshed = await refreshResearchOffer(
              database,
              providers,
              actor,
              selectedOffers[0],
              "detail",
            );
            expect(refreshed.offer.revision).toBe(2);
            await expect(
              acceptProposal(database, userId, trip.tripId, saved.id, {
                requestId: randomUUID(),
                expectedVersion: 1,
              }),
            ).rejects.toMatchObject({ status: 409 });
            expect((await readTrip(database, userId, trip.tripId)).version).toBe(1);
            expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toEqual(
              [],
            );
            return;
          }
          const accepted =
            applicationPolicy === "automatic"
              ? await readTrip(database, userId, trip.tripId)
              : await acceptProposal(database, userId, trip.tripId, saved.id, {
                  requestId: randomUUID(),
                  expectedVersion: 1,
                });
          expect(accepted.version).toBe(2);
          expect(accepted.snapshot.price.finalCustomerMinor).toBe(
            saved.previewSnapshot?.price.finalCustomerMinor,
          );
          expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toEqual(
            [],
          );
          const history = await database
            .selectFrom("tripVersions")
            .select(["changeSummary", "inverseOperation"])
            .where("tripId", "=", trip.tripId)
            .where("version", "=", 2)
            .executeTakeFirstOrThrow();
          expect(history.changeSummary.length).toBeGreaterThan(0);
          expect(history.inverseOperation).toBeTruthy();
          await expect(
            runs.reserve({ ...reservation, requestId: randomUUID() }),
          ).rejects.toMatchObject({ status: 409 });
          const restored = await undoDraft(database, userId, trip.tripId, {
            requestId: randomUUID(),
            expectedVersion: 2,
            restoreVersion: 1,
          });
          expect(restored.version).toBe(3);
          expect(restored.snapshot).toEqual(trip.snapshot);
          expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toEqual(
            [],
          );
        });
      },
      30000,
    );
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
