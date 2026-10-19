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
import { searchResearch, readResearchOffer, refreshResearchOffer, listResearch } from "../../server/supply/planning-research";
vi.mock("server-only", () => ({}));

describe.skipIf(!hasIsolatedDatabaseConfiguration())("supplier evidence access and immutable revisions", () => {
  it("persists research without trip mutation, separates browser ownership from active run grants and rejects stale revisions", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const owner = randomUUID();
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(database);
      const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
      snapshot.itineraryDays = [];
      const trip = await createTrip(database, owner, { requestId: randomUUID(), title: "Research", currency: "GBP", snapshot });
      const run = await new RunRepository(database).reserve({ userId: owner, tripId: trip.tripId, requestId: randomUUID(),
        baseTripVersion: 1, purpose: "supplier_research", message: "Compare current options" });
      const context = { userId: owner, tripId: trip.tripId, requestId: run.requestId, baseTripVersion: 1 };
      const proposal = changeProposalSchema.parse({
        id: randomUUID(), tripId: trip.tripId, agentRunId: run.id, initiatingRequestId: run.requestId,
        purpose: "initial_estimate", baseTripVersion: 1, operations: [{ operation: "replace", target: "/preferences/pace", value: 60 }],
        affectedFacts: ["preferences"], rationale: "Synthetic forbidden research proposal", status: "proposed",
        createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), previewSnapshot: snapshot,
        estimatedCostRange: { currency: "GBP", minimumMinor: snapshot.price.finalCustomerMinor, maximumMinor: snapshot.price.finalCustomerMinor },
        styleCompatibility: "Synthetic", constraintSummary: [], warnings: [],
      });
      await expect(new ProposalRepository(database).record(context, proposal)).rejects.toMatchObject({ status: 409 });
      await expect(database.insertInto("changeProposals").values({
        id: proposal.id, tripId: trip.tripId, agentRunId: run.id, initiatingRequestId: run.requestId,
        baseTripVersion: 1, purpose: "initial_estimate", proposal, requestFingerprint: "0".repeat(64), status: "proposed",
        createdAt: new Date(proposal.createdAt), expiresAt: new Date(proposal.expiresAt), appliedVersion: null,
      }).execute()).rejects.toMatchObject({ code: "23514" });
      const providers = createPlanningProviders("deterministic");
      const result = await searchResearch(database, providers, context, { componentTypes: ["flight", "accommodation", "activity", "rail"],
        startDate: "2030-05-01", endDate: "2030-05-08", destinationIds: snapshot.destinations.map((place) => place.id) });
      expect(result.offers).toHaveLength(4);
      expect(result.outcomes.at(-1)).toMatchObject({ componentType: "rail", status: "unsupported" });
      const first = result.offers[0];
      expect(first.offerRef).toBeTruthy();
      const reference = { offerRef: first.offerRef!, revision: first.revision! };
      const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
      expect((await readResearchOffer(database, actor, reference)).offer?.offerRef).toBe(reference.offerRef);
      const refreshed = await refreshResearchOffer(database, providers, actor, reference, "revalidation");
      expect(refreshed.outcome).toBe("unchanged");
      expect(refreshed.offer?.revision).toBe(2);
      await expect(refreshResearchOffer(database, providers, actor, reference, "revalidation")).rejects.toMatchObject({ status: 409 });
      expect((await readResearchOffer(database, actor, reference)).offer?.revision).toBe(1);
      const otherRun = await new RunRepository(database).reserve({ userId: owner, tripId: trip.tripId, requestId: randomUUID(),
        baseTripVersion: 1, purpose: "supplier_research", message: "Separate research" });
      await expect(readResearchOffer(database, { ...actor, requestId: otherRun.requestId }, reference)).rejects.toMatchObject({ status: 404 });
      await expect(readResearchOffer(database, { ...actor, userId: randomUUID() }, reference)).rejects.toMatchObject({ status: 404 });
      await database.updateTable("agentRuns").set({ status: "completed", leaseExpiresAt: null, completedAt: new Date() }).where("id", "=", run.id).execute();
      expect((await readResearchOffer(database, actor, reference)).offer).toBeTruthy();
      await expect(readResearchOffer(database, context, reference)).rejects.toMatchObject({ status: 409 });
      expect((await database.selectFrom("trips").select("currentVersion").where("id", "=", trip.tripId).executeTakeFirstOrThrow()).currentVersion).toBe(1);
      expect(await database.selectFrom("changeProposals").selectAll().execute()).toHaveLength(0);
      expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(0);
      await expect(searchResearch(database, providers, { ...actor, requestId: otherRun.requestId },
        { componentTypes: ["flight"], startDate: "2040-01-01", endDate: "2040-01-08", destinationIds: snapshot.destinations.map((place) => place.id) }))
        .rejects.toMatchObject({ status: 409 });
      const filtered = await searchResearch(database, providers, { ...actor, requestId: otherRun.requestId },
        { componentTypes: ["flight", "accommodation", "activity", "rail"], propertyTypes: ["villa"],
          startDate: "2030-05-01", endDate: "2030-05-08", destinationIds: snapshot.destinations.map((place) => place.id) });
      expect(filtered.offers).toHaveLength(3);
      expect(filtered.outcomes).toEqual(expect.arrayContaining([
        expect.objectContaining({ componentType: "accommodation", status: "unsupported" }),
        expect.objectContaining({ componentType: "rail", status: "unsupported" }),
      ]));
      const listed = await listResearch(database, actor);
      expect(listed.offers.map((offer) => offer.offerRef).sort()).toEqual(filtered.offers.map((offer) => offer.offerRef).sort());
      expect(listed.offers.some((offer) => offer.offerRef === reference.offerRef)).toBe(false);
      const repeated = await searchResearch(database, providers, { ...actor, requestId: otherRun.requestId },
        { componentTypes: ["flight", "accommodation", "activity", "rail"],
          startDate: "2030-05-01", endDate: "2030-05-08", destinationIds: snapshot.destinations.map((place) => place.id) });
      expect((await listResearch(database, actor)).offers.map((offer) => offer.offerRef).sort())
        .toEqual(repeated.offers.map((offer) => offer.offerRef).sort());
      const sameQuery = { componentTypes: ["flight", "accommodation", "activity", "rail"],
        startDate: "2030-05-01", endDate: "2030-05-08", destinationIds: snapshot.destinations.map((place) => place.id) };
      const latest = await searchResearch(database, providers, { ...actor, requestId: otherRun.requestId }, sameQuery);
      expect((await listResearch(database, actor)).offers.map((offer) => offer.offerRef).sort())
        .toEqual(latest.offers.map((offer) => offer.offerRef).sort());
      await expect(searchResearch(database, providers, { ...actor, requestId: otherRun.requestId },
        sameQuery, { signal: AbortSignal.abort() })).rejects.toMatchObject({ status: 504 });
    });
  }, 60_000);

  it("rechecks source-run revocation after an in-flight supplier read", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const owner = randomUUID();
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${owner},'Synthetic',${owner + "@example.invalid"})`.execute(database);
      const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
      snapshot.itineraryDays = [];
      const trip = await createTrip(database, owner, { requestId: randomUUID(), title: "Research", currency: "GBP", snapshot });
      const run = await new RunRepository(database).reserve({ userId: owner, tripId: trip.tripId, requestId: randomUUID(),
        baseTripVersion: 1, purpose: "supplier_research", message: "Compare current options" });
      const actor = { userId: owner, tripId: trip.tripId, baseTripVersion: 1 };
      const providers = createPlanningProviders("deterministic");
      const result = await searchResearch(database, providers, { ...actor, requestId: run.requestId },
        { componentTypes: ["flight"], startDate: "2030-05-01", endDate: "2030-05-08", destinationIds: snapshot.destinations.map((place) => place.id) });
      const first = result.offers[0], source = providers[0];
      let release: (() => void) | undefined, started: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const pending = new Promise<void>((resolve) => { started = resolve; });
      const slow = { ...source, async revalidate(...args: Parameters<NonNullable<typeof source.revalidate>>) {
        started?.(); await gate;
        return source.revalidate!(...args);
      } };
      const refresh = refreshResearchOffer(database, [slow], actor, { offerRef: first.offerRef, revision: 1 }, "revalidation");
      await pending;
      await database.updateTable("agentRuns").set({ planningAccessRevokedAt: new Date() }).where("id", "=", run.id).execute();
      release?.();
      await expect(refresh).rejects.toMatchObject({ status: 404 });
      expect(await database.selectFrom("planningOfferRecords").select("revision").where("runId", "=", run.id).execute())
        .toEqual([{ revision: 1 }, { revision: 1 }]);
    });
  }, 60_000);
});
