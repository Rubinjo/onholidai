// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { guestApiFixture, unrelatedGuest, type GuestApiFixture } from "../helpers/guest-api";
import { hasIsolatedDatabaseConfiguration } from "../helpers/database";
import { createServiceToken } from "../../server/agent-client/credentials";
import { readOwnedTripVersion } from "../../domain/trip/read";
import { POST as search } from "../../app/api/v1/internal/trips/[tripId]/planning-search/route";
import { GET as list } from "../../app/api/v1/trips/[tripId]/planning-offers/route";
import { GET as detail } from "../../app/api/v1/trips/[tripId]/planning-offers/[offerRef]/route";
import { POST as revalidate } from "../../app/api/v1/trips/[tripId]/planning-offers/[offerRef]/revalidations/route";
import { GET as capabilities } from "../../app/api/v1/internal/trips/[tripId]/planning-capabilities/route";
vi.mock("server-only", () => ({}));

describe.skipIf(!hasIsolatedDatabaseConfiguration())("supplier research HTTP access boundary", () => {
  let state: GuestApiFixture;
  beforeEach(async () => { state = await guestApiFixture(); }, 60_000);
  afterEach(async () => { await state?.cleanup(); });

  function internalRequest(path: string, body?: unknown, scopes: ("trip:read" | "run:write")[] = ["trip:read"]) {
    const context = { userId: state.run.ownerUserId, tripId: state.trip.tripId, requestId: state.run.requestId, baseTripVersion: 1 };
    const token = createServiceToken({ ...context, audience: "web", scopes, secret: state.application.config.SERVICE_TOKEN_SECRET });
    return new Request(`http://planning.test${path}`, { method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${token}`, "x-user-id": context.userId, "x-request-id": context.requestId,
        "x-base-trip-version": "1", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }

  it("uses signed current-run searches, then lets only the current owner inspect completed evidence", async () => {
    const tripId = state.trip.tripId, base = `/api/v1/trips/${tripId}`, internal = `/api/v1/internal/trips/${tripId}`;
    const route = { params: Promise.resolve({ tripId }) };
    const trip = await readOwnedTripVersion(state.fixture.database, state.run.ownerUserId, tripId, 1);
    const window = trip.snapshot.availabilityWindows[0];
    const query = { componentTypes: ["flight", "accommodation", "activity", "rail"],
      destinationIds: trip.snapshot.destinations.map((place) => place.id), startDate: window.startDate, endDate: window.endDate };
    expect((await search(internalRequest(`${internal}/planning-search`, query, ["run:write"]), route)).status).toBe(401);
    const response = await search(internalRequest(`${internal}/planning-search`, query), route);
    expect(response.status).toBe(200);
    const result = await response.json() as { offers: { offerRef: string; revision: number }[] };
    expect(result.offers.length).toBeGreaterThan(0);
    const offerRef = result.offers[0].offerRef, offerRoute = { params: Promise.resolve({ tripId, offerRef }) };
    const listed = await list(state.request(`${base}/planning-offers?version=1`), route);
    expect(listed.status).toBe(200);
    expect(listed.headers.get("cache-control")).toBe("private, no-store");
    const other = await unrelatedGuest(state.fixture);
    expect((await list(state.request(`${base}/planning-offers?version=1`, other), route)).status).toBe(404);
    expect((await list(state.request(`${base}/planning-offers?version=2`), route)).status).toBe(404);
    const hostile = state.request(`${base}/planning-offers/${offerRef}/revalidations?version=1`, state.credential, { revision: 1 });
    hostile.headers.set("origin", "https://foreign.invalid");
    expect((await revalidate(hostile, offerRoute)).status).toBe(403);
    expect((await revalidate(state.request(`${base}/planning-offers/${offerRef}/revalidations?version=1`,
      state.credential, { revision: 1, url: "https://foreign.invalid" }), offerRoute)).status).toBe(422);
    const inspected = await detail(state.request(`${base}/planning-offers/${offerRef}?version=1&revision=1`), offerRoute);
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({ offer: { offerRef, revision: 2 } });
    await state.fixture.database.updateTable("agentRuns").set({ status: "completed", completedAt: new Date(), leaseExpiresAt: null })
      .where("id", "=", state.run.id).execute();
    expect((await capabilities(internalRequest(`${internal}/planning-capabilities`), route)).status).toBe(409);
    expect((await list(state.request(`${base}/planning-offers?version=1`), route)).status).toBe(200);
    await state.fixture.database.updateTable("agentRuns").set({ planningAccessRevokedAt: new Date() }).where("id", "=", state.run.id).execute();
    expect((await detail(state.request(`${base}/planning-offers/${offerRef}?version=1&revision=2`), offerRoute)).status).toBe(404);
    expect(await state.fixture.database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(0);
    expect(await state.fixture.database.selectFrom("changeProposals").selectAll().execute()).toHaveLength(0);
  }, 60_000);
});
