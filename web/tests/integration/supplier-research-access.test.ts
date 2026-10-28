// @vitest-environment node
import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { withIsolatedTestDatabase, hasIsolatedDatabaseConfiguration } from "../helpers/database";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { nuiteeRatesResponse } from "../fixtures/providers";
import { createTrip } from "../../domain/trip/create";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { RunRepository } from "../../server/agent-client/run-repository";
import { ProposalRepository } from "../../server/db/proposal-repository";
import { changeProposalSchema } from "../../domain/trip/proposal";
import { createPlanningProviders } from "../../server/supply/providers";
import {
  searchResearch,
  readResearchOffer,
  refreshResearchOffer,
  listResearch,
  researchCapabilities,
} from "../../server/supply/planning-research";
import { deriveProviderReadiness, loadServerConfig } from "../../server/config";
import {
  createNuiteeReadProvider,
  createNuiteeHttpClient,
} from "../../server/supply/providers/nuitee-read";
import {
  createViatorReadProvider,
  createViatorHttpClient,
} from "../../server/supply/providers/viator-read";
import { normalizePlanningOffer, projectPublicPlanningOffer } from "../../server/supply/offers";
import { SupplyReadError } from "../../server/supply/read";

vi.mock("server-only", () => ({}));

describe.skipIf(!hasIsolatedDatabaseConfiguration())(
  "supplier evidence access and immutable revisions",
  () => {
    it("persists and refreshes the exact per-stop search instead of the full multi-city window", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const first = snapshot.destinations[0];
        const second = { ...first, id: randomUUID(), name: "Porto", routePosition: 1 };
        snapshot.destinations = [first, second];
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Multi-city research",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Research both stops",
        });
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const provider = createPlanningProviders("deterministic").find(
          (entry) => entry.capabilities.provider === "nuitee",
        )!;
        const search = vi.spyOn(provider, "search");
        const detail = vi.spyOn(provider, "detail");
        const result = await searchResearch(
          database,
          [provider],
          { ...actor, requestId: run.requestId },
          {
            componentTypes: ["accommodation"],
            destinationIds: [second.id, first.id],
            startDate: "2030-05-01",
            endDate: "2030-05-08",
          },
        );
        expect(search.mock.calls.map(([query]) => query.destinations?.[0].id)).toEqual([
          second.id,
          first.id,
        ]);
        expect(result.offers).toHaveLength(2);
        const selected = result.offers.find(
          (offer) => offer.selectionGroup === "accommodation:stop:1",
        )!;
        const refreshed = await refreshResearchOffer(
          database,
          [provider],
          actor,
          { offerRef: selected.offerRef, revision: selected.revision },
          "detail",
        );
        expect(detail.mock.calls[0][1]).toMatchObject({
          destinationIds: [first.id],
          startDate: "2030-05-05",
          endDate: "2030-05-08",
        });
        expect(refreshed.offer.selectionGroup).toBe(selected.selectionGroup);
        expect(refreshed.offer.revision).toBe(2);
      });
    }, 60_000);

    it("persists long selected Nuitee multi-room IDs and changed detail without inventing checkout or expiry", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        snapshot.travellerParty = {
          adults: 4,
          children: [{ id: randomUUID(), ageAtTripStart: 7 }],
        };
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Nuitee wire evidence",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Compare two rooms",
        });
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const context = { ...actor, requestId: run.requestId };
        const wire = nuiteeRatesResponse();
        const selected = wire.data[0].roomTypes[0];
        const offerId = `${"Q".repeat(1152)}+/==`;
        const rateId = "r".repeat(549);
        selected.offerId = offerId;
        selected.rates[0].rateId = rateId;
        selected.offerRetailRate[0].amount = "200.20";
        selected.suggestedSellingPrice[0].amount = "220.40";
        selected.rates[0].childCount = 1;
        selected.rates[0].childrenAges = [7];
        selected.rates.push({
          ...structuredClone(selected.rates[0]),
          occupancyNumber: 2,
          rateId: "second_rate",
          mappedRoomId: "second_room",
          childCount: 0,
          childrenAges: [],
        });
        const transport = vi.fn<typeof fetch>(async (url) =>
          Response.json(
            String(url).includes("/data/hotel")
              ? { data: { id: "synthetic_hotel", name: "Synthetic hotel", hotelType: "hotel" } }
              : {
                  ...wire,
                  data: [
                    {
                      ...wire.data[0],
                      roomTypes: [
                        {
                          ...selected,
                          offerRetailRate: selected.offerRetailRate[0],
                          suggestedSellingPrice: selected.suggestedSellingPrice[0],
                        },
                      ],
                    },
                  ],
                },
          ),
        );
        const provider = createNuiteeReadProvider(
          createNuiteeHttpClient({
            apiKey: "synthetic-shared-key-canary",
            environment: "sandbox",
            fetch: transport,
            resolveSearch: () => ({
              hotelIds: ["synthetic_hotel"],
              guestNationality: "GB",
              sessionId: "sourced_session",
              occupancies: [
                { adults: 2, children: [7] },
                { adults: 2, children: [] },
              ],
            }),
          }),
        );
        const result = await searchResearch(database, [provider], context, {
          componentTypes: ["accommodation"],
          startDate: "2030-05-01",
          endDate: "2030-05-08",
          destinationIds: snapshot.destinations.map((place) => place.id),
        });
        expect(result.offers).toHaveLength(1);
        const original = result.offers[0];
        expect(original).toMatchObject({
          component: {
            provider: "nuitee",
            supplierOfferId: offerId,
            price: { finalCustomerMinor: 23040 },
          },
          supplierReferences: {
            rateIds: [rateId, "second_rate"],
            roomIds: ["synthetic_room", "second_room"],
            sessionId: "sourced_session",
          },
        });
        const reference = { offerRef: original.offerRef!, revision: 1 };
        for (const reader of [actor, context]) {
          expect((await readResearchOffer(database, reader, reference)).offer).toEqual(original);
        }
        selected.suggestedSellingPrice[0].amount = "240.40";
        selected.rates[0].cancellationPolicies.refundableTag = "NRFN";
        selected.rates[0].boardName = "Room only";
        const updated = await refreshResearchOffer(
          database,
          [provider],
          context,
          reference,
          "detail",
        );
        expect(updated.outcome).toBe("unknown");
        expect(updated.differences).toHaveLength(1);
        expect(updated.offer).toMatchObject({
          offerRef: reference.offerRef,
          revision: 2,
          component: {
            provider: "nuitee",
            serviceStart: null,
            serviceEnd: null,
            expiresAt: null,
            price: { finalCustomerMinor: 25040, status: "estimated" },
          },
          evidence: { status: "estimated", availability: "unknown", expiresAt: null },
        });
        expect(updated.offer.component.planningDetails?.fareConditions).toContain("NRFN");
        expect(updated.offer.component.planningDetails?.fareConditions).toContain("Room only");
        for (const reader of [actor, context]) {
          expect(
            (await readResearchOffer(database, reader, { ...reference, revision: 2 })).offer,
          ).toEqual(updated.offer);
          expect((await readResearchOffer(database, reader, reference)).offer).toEqual(original);
        }
        expect((await listResearch(database, actor)).offers).toEqual([updated.offer]);
        const calls = transport.mock.calls.length;
        expect(
          (
            await refreshResearchOffer(
              database,
              [provider],
              context,
              { ...reference, revision: 2 },
              "revalidation",
            )
          ).outcome,
        ).toBe("unsupported");
        expect(transport).toHaveBeenCalledTimes(calls);
        expect(transport.mock.calls.map(([url]) => String(url))).toEqual([
          "https://api.liteapi.travel/v3.0/hotels/rates",
          "https://api.liteapi.travel/v3.0/data/hotel?hotelId=synthetic_hotel",
          "https://api.liteapi.travel/v3.0/hotels/rates",
        ]);
        const saved = await database
          .selectFrom("planningOfferRecords")
          .selectAll()
          .where("offerRef", "=", reference.offerRef)
          .where("revision", "=", 2)
          .executeTakeFirstOrThrow();
        const expired = normalizePlanningOffer(saved.offer);
        expect(expired.component.supplierOfferId).toBe(offerId);
        expect(expired.supplierReferences?.rateIds).toEqual([rateId, "second_rate"]);
        expired.offerRef = randomUUID();
        expired.component.id = randomUUID();
        expired.revision = 1;
        expired.component.expiresAt = "2020-01-01T00:00:00Z";
        expired.component.price.expiresAt = expired.component.expiresAt;
        await database
          .insertInto("planningOfferRecords")
          .values({
            runId: run.id,
            componentId: expired.component.id,
            offerRef: expired.offerRef,
            offer: expired,
            query: saved.query,
          })
          .execute();
        const readExpired = await readResearchOffer(database, actor, {
          offerRef: expired.offerRef,
          revision: 1,
        });
        expect(readExpired).toMatchObject({
          outcome: "expired",
          offer: { component: { offerStatus: "expired", price: { status: "expired" } } },
        });
        expect(JSON.stringify([result, updated, readExpired])).not.toMatch(
          /synthetic-shared-key-canary|supplierAmount|platformMargin|guestNationality|NUITEE_SECRET/,
        );
        expect(
          await database
            .selectFrom("trips")
            .select("currentVersion")
            .where("id", "=", trip.tripId)
            .executeTakeFirstOrThrow(),
        ).toMatchObject({ currentVersion: 1 });
        expect(await database.selectFrom("changeProposals").selectAll().execute()).toHaveLength(0);
        expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(
          0,
        );
      });
    }, 60_000);

    it("isolates a Nuitee outage and preserves saved Duffel stay evidence without refresh or fallback", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Current and historical stay evidence",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Compare current sources",
        });
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const context = { ...actor, requestId: run.requestId };
        const providers = createPlanningProviders("deterministic");
        const query = {
          componentTypes: ["flight", "accommodation", "activity", "rail"],
          startDate: "2030-05-01",
          endDate: "2030-05-08",
          destinationIds: snapshot.destinations.map((place) => place.id),
        };
        const result = await searchResearch(database, providers, context, query);
        const stay = result.offers.find((offer) => offer.component.type === "accommodation")!;
        const saved = await database
          .selectFrom("planningOfferRecords")
          .selectAll()
          .where("offerRef", "=", stay.offerRef!)
          .executeTakeFirstOrThrow();
        const legacy = normalizePlanningOffer(saved.offer);
        legacy.offerRef = randomUUID();
        legacy.component.id = randomUUID();
        legacy.component.provider = "duffel";
        legacy.attribution.provider = "duffel";
        legacy.component.supplierOfferId = "historical_duffel_stay";
        legacy.component.price.source = "duffel";
        legacy.supplierReferences = {
          accommodationId: "historical_duffel_hotel",
          searchResultId: "historical_duffel_result",
        };
        await database
          .insertInto("planningOfferRecords")
          .values({
            runId: run.id,
            componentId: legacy.component.id,
            offerRef: legacy.offerRef,
            offer: legacy,
            query: saved.query,
          })
          .execute();
        const reference = { offerRef: legacy.offerRef, revision: 1 };
        for (const reader of [actor, context]) {
          expect((await readResearchOffer(database, reader, reference)).offer).toEqual(
            projectPublicPlanningOffer(legacy),
          );
        }
        for (const operation of ["detail", "revalidation"] as const) {
          const refreshed = await refreshResearchOffer(
            database,
            providers,
            context,
            reference,
            operation,
          );
          expect(refreshed.outcome).toBe("unsupported");
          expect(refreshed.offer).toEqual(projectPublicPlanningOffer(legacy));
        }
        const nuitee = providers.find((source) => source.capabilities.provider === "nuitee")!;
        vi.spyOn(nuitee, "search").mockRejectedValue(new SupplyReadError("error"));
        const partial = await searchResearch(database, providers, context, query);
        expect(partial.outcomes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ provider: "duffel", status: "available" }),
            expect.objectContaining({ provider: "nuitee", status: "error" }),
            expect.objectContaining({ provider: "viator", status: "available" }),
            expect.objectContaining({ componentType: "rail", status: "unsupported" }),
          ]),
        );
        expect(partial.offers).toHaveLength(3);
        expect(partial.offers.some((offer) => offer.component.type === "accommodation")).toBe(
          false,
        );
        expect(
          await database
            .selectFrom("planningOfferRecords")
            .select("revision")
            .where("offerRef", "=", legacy.offerRef)
            .execute(),
        ).toEqual([{ revision: 1 }]);
        expect(
          await database
            .selectFrom("trips")
            .select("currentVersion")
            .where("id", "=", trip.tripId)
            .executeTakeFirstOrThrow(),
        ).toMatchObject({ currentVersion: 1 });
        expect(await database.selectFrom("changeProposals").selectAll().execute()).toHaveLength(0);
        expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(
          0,
        );
      });
    }, 60_000);

    it("retries read evidence once on rate guidance and commits only one concurrent revision", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Concurrent reads",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Compare current options",
        });
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const source = createPlanningProviders("deterministic").find(
          (provider) => provider.capabilities.provider === "viator",
        )!;
        const result = await searchResearch(
          database,
          [source],
          { ...actor, requestId: run.requestId },
          {
            componentTypes: ["activity"],
            startDate: "2030-05-01",
            endDate: "2030-05-08",
            destinationIds: snapshot.destinations.map((destination) => destination.id),
          },
        );
        const reference = { offerRef: result.offers[0].offerRef!, revision: 1 };
        const detail = vi
          .fn(source.detail!)
          .mockRejectedValueOnce(new SupplyReadError("rate_limited", 0));
        const refreshed = await refreshResearchOffer(
          database,
          [{ ...source, detail }],
          actor,
          reference,
          "detail",
        );
        expect(detail).toHaveBeenCalledTimes(2);
        expect(refreshed.offer.revision).toBe(2);

        let entered!: () => void;
        let release!: () => void;
        const bothReading = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const ready = new Promise<void>((resolve) => {
          release = resolve;
        });
        let reads = 0;
        const revalidate: NonNullable<typeof source.revalidate> = async (...args) => {
          if (++reads === 2) entered();
          await ready;
          return source.revalidate!(...args);
        };
        const refresh = () =>
          refreshResearchOffer(
            database,
            [{ ...source, revalidate }],
            actor,
            { ...reference, revision: 2 },
            "revalidation",
          );
        const first = refresh(),
          second = refresh();
        const settled = Promise.allSettled([first, second]);
        await bothReading;
        release();
        const outcomes = await settled;
        expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
        const rejected = outcomes.find((outcome) => outcome.status === "rejected");
        expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ status: 409 });
        const rows = await database
          .selectFrom("planningOfferRecords")
          .select("revision")
          .where("offerRef", "=", reference.offerRef)
          .orderBy("revision")
          .execute();
        expect(rows).toEqual([{ revision: 1 }, { revision: 2 }, { revision: 3 }]);
        expect((await readResearchOffer(database, actor, reference)).offer).toEqual(
          result.offers[0],
        );
        expect(
          (
            await database
              .selectFrom("trips")
              .select("currentVersion")
              .where("id", "=", trip.tripId)
              .executeTakeFirstOrThrow()
          ).currentVersion,
        ).toBe(1);
        expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(
          0,
        );
      });
    }, 60_000);

    it("rejects cancelled refreshes before supplier calls and cannot persist late evidence", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Cancelled reads",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Compare current options",
        });
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const source = createPlanningProviders("deterministic").find(
          (provider) => provider.capabilities.provider === "viator",
        )!;
        const result = await searchResearch(
          database,
          [source],
          { ...actor, requestId: run.requestId },
          {
            componentTypes: ["activity"],
            startDate: "2030-05-01",
            endDate: "2030-05-08",
            destinationIds: snapshot.destinations.map((destination) => destination.id),
          },
        );
        const reference = { offerRef: result.offers[0].offerRef!, revision: 1 };
        const detail = vi.fn(source.detail!);
        await expect(
          refreshResearchOffer(database, [{ ...source, detail }], actor, reference, "detail", {
            signal: AbortSignal.abort(),
          }),
        ).rejects.toMatchObject({ status: 504 });
        expect(detail).not.toHaveBeenCalled();
        const abort = new AbortController();
        const late: NonNullable<typeof source.detail> = async (...args) => {
          const evidence = await source.detail!(...args);
          abort.abort();
          return evidence;
        };
        await expect(
          refreshResearchOffer(
            database,
            [{ ...source, detail: late }],
            actor,
            reference,
            "detail",
            { signal: abort.signal },
          ),
        ).rejects.toMatchObject({ status: 504 });
        expect(
          await database
            .selectFrom("planningOfferRecords")
            .select("revision")
            .where("offerRef", "=", reference.offerRef)
            .execute(),
        ).toEqual([{ revision: 1 }]);
        expect((await readResearchOffer(database, actor, reference)).offer).toEqual(
          result.offers[0],
        );
      });
    }, 60_000);

    it("persists content-only availability as unknown and appends unavailable evidence without mutating the trip", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Source availability",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Compare current options",
        });
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const product = { productCode: "SYNTHETIC1", title: "Synthetic content-only activity" };
        const transport = vi.fn<typeof fetch>(
          async (url) =>
            new Response(
              JSON.stringify(
                String(url).endsWith("/products/search")
                  ? { products: [product] }
                  : String(url).endsWith("/availability/check")
                    ? {
                        productCode: product.productCode,
                        travelDate: "2030-05-01",
                        currency: "GBP",
                        bookableItems: [{ available: false }],
                      }
                    : product,
              ),
            ),
        );
        const source = createViatorReadProvider(
          createViatorHttpClient({
            apiKey: "synthetic-read-key",
            fetch: transport,
            resolveDestination: () => "1234",
            resolvePaxMix: (query) => [
              {
                ageBand: "TRAVELER",
                numberOfTravelers:
                  query.travellerParty.adults + query.travellerParty.children.length,
              },
            ],
          }),
        );
        const result = await searchResearch(
          database,
          [source],
          { ...actor, requestId: run.requestId },
          {
            componentTypes: ["activity"],
            startDate: "2030-05-01",
            endDate: "2030-05-01",
            destinationIds: [snapshot.destinations[0].id],
          },
        );
        expect(result.offers).toHaveLength(1);
        const original = result.offers[0];
        expect(original.evidence?.availability).toBe("unknown");
        const detail = await refreshResearchOffer(
          database,
          [source],
          actor,
          { offerRef: original.offerRef, revision: 1 },
          "detail",
        );
        expect(detail.outcome).toBe("unknown");
        expect(detail.offer.evidence?.availability).toBe("unknown");
        const unavailable = await refreshResearchOffer(
          database,
          [source],
          actor,
          { offerRef: original.offerRef, revision: 2 },
          "revalidation",
        );
        expect(unavailable).toMatchObject({
          outcome: "unavailable",
          offer: {
            revision: 3,
            evidence: { availability: "unavailable" },
            component: { offerStatus: "unavailable" },
          },
        });
        const rows = await database
          .selectFrom("planningOfferRecords")
          .select(["revision", "offer"])
          .where("offerRef", "=", original.offerRef!)
          .orderBy("revision")
          .execute();
        const records = rows.map((row) => ({
          revision: row.revision,
          offer: normalizePlanningOffer(row.offer),
        }));
        expect(
          records.map((record) => [record.revision, record.offer.evidence?.availability]),
        ).toEqual([
          [1, "unknown"],
          [2, "unknown"],
          [3, "unavailable"],
        ]);
        expect(records[0].offer.component.id).toBe(unavailable.offer.component.id);
        expect((await listResearch(database, actor)).offers).toEqual([unavailable.offer]);
        expect(
          (
            await database
              .selectFrom("trips")
              .select("currentVersion")
              .where("id", "=", trip.tripId)
              .executeTakeFirstOrThrow()
          ).currentVersion,
        ).toBe(1);
        expect(
          await readResearchOffer(database, actor, { offerRef: original.offerRef, revision: 1 }),
        ).toMatchObject({ outcome: "unknown", offer: original });
        expect(
          await readResearchOffer(database, actor, { offerRef: original.offerRef, revision: 3 }),
        ).toMatchObject({ outcome: "unavailable", offer: unavailable.offer });
        expect(await database.selectFrom("changeProposals").selectAll().execute()).toHaveLength(0);
        expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(
          0,
        );
        expect(transport).toHaveBeenCalledTimes(4);
        expect(JSON.stringify(unavailable)).not.toContain("synthetic-read-key");
      });
    }, 60_000);

    it("rechecks product support before detail/revalidation and preserves prior evidence when blocked", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Read readiness",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Compare current options",
        });
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const providers = createPlanningProviders("deterministic");
        const result = await searchResearch(
          database,
          providers,
          { ...actor, requestId: run.requestId },
          {
            componentTypes: ["activity"],
            startDate: "2030-05-01",
            endDate: "2030-05-08",
            destinationIds: snapshot.destinations.map((destination) => destination.id),
          },
        );
        const reference = { offerRef: result.offers[0].offerRef!, revision: 1 };
        const source = providers.find((provider) => provider.capabilities.provider === "viator")!;
        const detail = vi.spyOn(source, "detail");
        const revalidate = vi.spyOn(source, "revalidate");
        const readiness = deriveProviderReadiness(loadServerConfig({}), {});
        for (const operation of ["detail", "revalidation"] as const) {
          readiness.viator.products.activity.operations[operation] = {
            support: "unsupported",
            access: "blocked",
            verifiedAt: null,
            safeReason: "Synthetic unsupported operation.",
          };
          const refreshed = await refreshResearchOffer(
            database,
            providers,
            actor,
            reference,
            operation,
            { readiness },
          );
          expect(refreshed.outcome).toBe("unsupported");
          expect(refreshed.offer).toEqual(result.offers[0]);
        }
        const deterministicCapabilities = await researchCapabilities(
          database,
          providers,
          readiness,
          actor,
        );
        expect(
          deterministicCapabilities.capabilities.find(
            (capability) => capability.componentType === "activity",
          )?.operations,
        ).toMatchObject({
          detail: { support: "unsupported", access: "blocked" },
          revalidation: { support: "unsupported", access: "blocked" },
        });
        readiness.viator.mode = "live";
        for (const support of ["supported", "unknown"] as const) {
          for (const operation of ["detail", "revalidation"] as const) {
            readiness.viator.products.activity.operations[operation] = {
              support,
              access: support === "supported" ? "configured_unverified" : "verified",
              verifiedAt: null,
              safeReason: "Synthetic missing operation verification.",
            };
            const refreshed = await refreshResearchOffer(
              database,
              providers,
              actor,
              reference,
              operation,
              { readiness },
            );
            expect(refreshed.outcome).toBe("unknown");
            expect(refreshed.offer).toEqual(result.offers[0]);
          }
        }
        const transport = vi.fn<typeof fetch>();
        const liveStays = createNuiteeReadProvider(
          createNuiteeHttpClient({
            apiKey: "synthetic-read-canary",
            environment: "sandbox",
            fetch: transport,
            resolveSearch: () => null,
          }),
        );
        readiness.nuitee.mode = "live";
        readiness.nuitee.products.accommodation.operations.revalidation = {
          support: "supported",
          access: "verified",
          verifiedAt: "2026-10-20T00:00:00Z",
          safeReason: "Synthetic configuration is not proof of implementation.",
        };
        const reported = await researchCapabilities(database, [liveStays], readiness, actor, [
          "accommodation",
          "rail",
        ]);
        expect(reported).toMatchObject({
          readOnly: true,
          maximumOffers: 32,
          overallDeadlineMs: 12_000,
          queryLimits: { maximumComponentTypes: 4, maximumDestinations: 8 },
        });
        expect(reported.capabilities[0]).toMatchObject({
          provider: "nuitee",
          componentType: "accommodation",
          operations: {
            revalidation: { support: "unsupported", access: "blocked", verifiedAt: null },
          },
          propertyTypes: null,
          coverage: null,
          rateLimit: null,
          freshnessMaxAgeMs: null,
          sourceDeadlineMs: 8_000,
        });
        expect(reported.capabilities[0].limitations.length).toBeGreaterThan(0);
        expect(reported.capabilities[1]).toMatchObject({
          provider: null,
          componentType: "rail",
          operations: { search: { support: "unsupported", access: "blocked" } },
        });
        expect(transport).not.toHaveBeenCalled();
        expect(JSON.stringify(reported)).not.toMatch(/read-canary|SecretRef/);
        expect(detail).not.toHaveBeenCalled();
        expect(revalidate).not.toHaveBeenCalled();
        expect(
          await database.selectFrom("planningOfferRecords").selectAll().execute(),
        ).toHaveLength(1);
        expect(
          (
            await database
              .selectFrom("trips")
              .select("currentVersion")
              .where("id", "=", trip.tripId)
              .executeTakeFirstOrThrow()
          ).currentVersion,
        ).toBe(1);
        expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(
          0,
        );
      });
    });

    it("persists research without trip mutation, separates browser ownership from active run grants and rejects stale revisions", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Research",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Compare current options",
        });
        const context = {
          userId: owner,
          tripId: trip.tripId,
          requestId: run.requestId,
          baseTripVersion: 1,
        };
        const proposal = changeProposalSchema.parse({
          id: randomUUID(),
          tripId: trip.tripId,
          agentRunId: run.id,
          initiatingRequestId: run.requestId,
          purpose: "initial_estimate",
          baseTripVersion: 1,
          operations: [{ operation: "replace", target: "/preferences/pace", value: 60 }],
          affectedFacts: ["preferences"],
          rationale: "Synthetic forbidden research proposal",
          status: "proposed",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          previewSnapshot: snapshot,
          estimatedCostRange: {
            currency: "GBP",
            minimumMinor: snapshot.price.finalCustomerMinor,
            maximumMinor: snapshot.price.finalCustomerMinor,
          },
          styleCompatibility: "Synthetic",
          constraintSummary: [],
          warnings: [],
        });
        await expect(
          new ProposalRepository(database).record(context, proposal),
        ).rejects.toMatchObject({ status: 409 });
        await expect(
          database
            .insertInto("changeProposals")
            .values({
              id: proposal.id,
              tripId: trip.tripId,
              agentRunId: run.id,
              initiatingRequestId: run.requestId,
              baseTripVersion: 1,
              purpose: "initial_estimate",
              proposal,
              requestFingerprint: "0".repeat(64),
              status: "proposed",
              createdAt: new Date(proposal.createdAt),
              expiresAt: new Date(proposal.expiresAt),
              appliedVersion: null,
            })
            .execute(),
        ).rejects.toMatchObject({ code: "23514" });
        const providers = createPlanningProviders("deterministic");
        const result = await searchResearch(database, providers, context, {
          componentTypes: ["flight", "accommodation", "activity", "rail"],
          startDate: "2030-05-01",
          endDate: "2030-05-08",
          destinationIds: snapshot.destinations.map((place) => place.id),
        });
        expect(result.offers).toHaveLength(4);
        expect(
          result.offers.map((offer) => [offer.component.provider, offer.component.type]),
        ).toEqual([
          ["duffel", "flight"],
          ["nuitee", "accommodation"],
          ["viator", "activity"],
          ["duffel", "flight"],
        ]);
        expect(result.outcomes.at(-1)).toMatchObject({
          componentType: "rail",
          status: "unsupported",
        });
        const first = result.offers[0];
        expect(first.offerRef).toBeTruthy();
        const reference = { offerRef: first.offerRef!, revision: first.revision! };
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const stay = result.offers.find((offer) => offer.component.type === "accommodation")!;
        const stayReference = { offerRef: stay.offerRef!, revision: stay.revision! };
        expect((await readResearchOffer(database, actor, stayReference)).offer).toEqual(stay);
        expect((await readResearchOffer(database, context, stayReference)).offer).toEqual(stay);
        expect((await readResearchOffer(database, actor, reference)).offer?.offerRef).toBe(
          reference.offerRef,
        );
        const revalidate = vi.spyOn(providers[0], "revalidate");
        const refreshed = await refreshResearchOffer(
          database,
          providers,
          actor,
          reference,
          "revalidation",
        );
        expect(refreshed.outcome).toBe("unchanged");
        expect(refreshed.offer?.revision).toBe(2);
        await expect(
          refreshResearchOffer(database, providers, actor, reference, "revalidation"),
        ).rejects.toMatchObject({ status: 409 });
        expect(revalidate).toHaveBeenCalledTimes(1);
        expect((await readResearchOffer(database, actor, reference)).offer?.revision).toBe(1);
        const otherRun = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Separate research",
        });
        await expect(
          readResearchOffer(database, { ...actor, requestId: otherRun.requestId }, reference),
        ).rejects.toMatchObject({ status: 404 });
        await expect(
          readResearchOffer(database, { ...actor, userId: randomUUID() }, reference),
        ).rejects.toMatchObject({ status: 404 });
        await database
          .updateTable("agentRuns")
          .set({ status: "completed", leaseExpiresAt: null, completedAt: new Date() })
          .where("id", "=", run.id)
          .execute();
        expect((await readResearchOffer(database, actor, reference)).offer).toBeTruthy();
        await expect(readResearchOffer(database, context, reference)).rejects.toMatchObject({
          status: 409,
        });
        expect(
          (
            await database
              .selectFrom("trips")
              .select("currentVersion")
              .where("id", "=", trip.tripId)
              .executeTakeFirstOrThrow()
          ).currentVersion,
        ).toBe(1);
        expect(await database.selectFrom("changeProposals").selectAll().execute()).toHaveLength(0);
        expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(
          0,
        );
        await expect(
          searchResearch(
            database,
            providers,
            { ...actor, requestId: otherRun.requestId },
            {
              componentTypes: ["flight"],
              startDate: "2040-01-01",
              endDate: "2040-01-08",
              destinationIds: snapshot.destinations.map((place) => place.id),
            },
          ),
        ).rejects.toMatchObject({ status: 409 });
        const filtered = await searchResearch(
          database,
          providers,
          { ...actor, requestId: otherRun.requestId },
          {
            componentTypes: ["flight", "accommodation", "activity", "rail"],
            propertyTypes: ["villa"],
            startDate: "2030-05-01",
            endDate: "2030-05-08",
            destinationIds: snapshot.destinations.map((place) => place.id),
          },
        );
        expect(filtered.offers).toHaveLength(3);
        expect(filtered.outcomes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ componentType: "accommodation", status: "unsupported" }),
            expect.objectContaining({ componentType: "rail", status: "unsupported" }),
          ]),
        );
        const listed = await listResearch(database, actor);
        expect(listed.offers.map((offer) => offer.offerRef).sort()).toEqual(
          filtered.offers.map((offer) => offer.offerRef).sort(),
        );
        expect(listed.offers.some((offer) => offer.offerRef === reference.offerRef)).toBe(false);
        const repeated = await searchResearch(
          database,
          providers,
          { ...actor, requestId: otherRun.requestId },
          {
            componentTypes: ["flight", "accommodation", "activity", "rail"],
            startDate: "2030-05-01",
            endDate: "2030-05-08",
            destinationIds: snapshot.destinations.map((place) => place.id),
          },
        );
        expect(
          (await listResearch(database, actor)).offers.map((offer) => offer.offerRef).sort(),
        ).toEqual(repeated.offers.map((offer) => offer.offerRef).sort());
        const sameQuery = {
          componentTypes: ["flight", "accommodation", "activity", "rail"],
          startDate: "2030-05-01",
          endDate: "2030-05-08",
          destinationIds: snapshot.destinations.map((place) => place.id),
        };
        const latest = await searchResearch(
          database,
          providers,
          { ...actor, requestId: otherRun.requestId },
          sameQuery,
        );
        expect(
          (await listResearch(database, actor)).offers.map((offer) => offer.offerRef).sort(),
        ).toEqual(latest.offers.map((offer) => offer.offerRef).sort());
        await expect(
          searchResearch(
            database,
            providers,
            { ...actor, requestId: otherRun.requestId },
            sameQuery,
            { signal: AbortSignal.abort() },
          ),
        ).rejects.toMatchObject({ status: 504 });
      });
    }, 60_000);

    it("rechecks source-run revocation after an in-flight supplier read", async () => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const owner = randomUUID();
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(
          database,
        );
        const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
        snapshot.itineraryDays = [];
        const trip = await createTrip(database, owner, {
          requestId: randomUUID(),
          title: "Research",
          currency: "GBP",
          snapshot,
        });
        const run = await new RunRepository(database).reserve({
          userId: owner,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
          purpose: "supplier_research",
          message: "Compare current options",
        });
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
        const providers = createPlanningProviders("deterministic");
        const result = await searchResearch(
          database,
          providers,
          { ...actor, requestId: run.requestId },
          {
            componentTypes: ["flight"],
            startDate: "2030-05-01",
            endDate: "2030-05-08",
            destinationIds: snapshot.destinations.map((place) => place.id),
          },
        );
        const first = result.offers[0],
          source = providers[0];
        let release: (() => void) | undefined, started: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const pending = new Promise<void>((resolve) => {
          started = resolve;
        });
        const slow = {
          ...source,
          async revalidate(...args: Parameters<NonNullable<typeof source.revalidate>>) {
            started?.();
            await gate;
            return source.revalidate!(...args);
          },
        };
        const refresh = refreshResearchOffer(
          database,
          [slow],
          actor,
          { offerRef: first.offerRef, revision: 1 },
          "revalidation",
        );
        await pending;
        await database
          .updateTable("agentRuns")
          .set({ planningAccessRevokedAt: new Date() })
          .where("id", "=", run.id)
          .execute();
        release?.();
        await expect(refresh).rejects.toMatchObject({ status: 404 });
        expect(
          await database
            .selectFrom("planningOfferRecords")
            .select("revision")
            .where("runId", "=", run.id)
            .execute(),
        ).toEqual([{ revision: 1 }, { revision: 1 }]);
      });
    }, 60_000);
  },
);
