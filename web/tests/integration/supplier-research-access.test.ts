// @vitest-environment node
import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { withIsolatedTestDatabase, hasIsolatedDatabaseConfiguration } from "../helpers/database";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
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
  createDuffelStaysReadProvider,
  createDuffelStaysHttpClient,
} from "../../server/supply/providers/duffel-stays-read";
import {
  createViatorReadProvider,
  createViatorHttpClient,
} from "../../server/supply/providers/viator-read";
import { normalizePlanningOffer } from "../../server/supply/offers";
import { SupplyReadError } from "../../server/supply/read";

vi.mock("server-only", () => ({}));

describe.skipIf(!hasIsolatedDatabaseConfiguration())(
  "supplier evidence access and immutable revisions",
  () => {
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
        const liveStays = createDuffelStaysReadProvider(
          createDuffelStaysHttpClient({
            readToken: "synthetic-read-canary",
            accessApproved: true,
            fetch: transport,
            resolveSearch: () => null,
          }),
        );
        readiness.duffel.mode = "live";
        readiness.duffel.products.accommodation.operations.revalidation = {
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
          provider: "duffel",
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
        expect(result.outcomes.at(-1)).toMatchObject({
          componentType: "rail",
          status: "unsupported",
        });
        const first = result.offers[0];
        expect(first.offerRef).toBeTruthy();
        const reference = { offerRef: first.offerRef!, revision: first.revision! };
        const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
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
