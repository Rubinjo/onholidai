// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { principalAllows } from "../../server/auth/planning-actor";
import { hasIsolatedDatabaseConfiguration } from "../helpers/database";
import { guestApiFixture, unrelatedGuest, type GuestApiFixture } from "../helpers/guest-api";
import { GET as readTrip } from "../../app/api/v1/trips/[tripId]/route";
import { GET as versions } from "../../app/api/v1/trips/[tripId]/versions/route";
import { GET as tripEvents } from "../../app/api/v1/trips/[tripId]/events/route";
import { GET as conversations } from "../../app/api/v1/trips/[tripId]/conversations/route";
import { POST as edit } from "../../app/api/v1/trips/[tripId]/commands/edit/route";
import { POST as preview } from "../../app/api/v1/trips/[tripId]/commands/edit-preview/route";
import { POST as undo } from "../../app/api/v1/trips/[tripId]/commands/undo/route";
import { POST as finalize } from "../../app/api/v1/trips/[tripId]/commands/finalize/route";
import { POST as accept } from "../../app/api/v1/trips/[tripId]/proposals/[proposalId]/accept/route";
import { POST as reject } from "../../app/api/v1/trips/[tripId]/proposals/[proposalId]/reject/route";
import { GET as readRun } from "../../app/api/v1/agent-runs/[runId]/route";
import { GET as runEvents } from "../../app/api/v1/agent-runs/[runId]/events/route";
import { POST as clarification } from "../../app/api/v1/agent-runs/[runId]/clarifications/route";
import { POST as revalidate } from "../../app/api/v1/trips/[tripId]/booking/revalidations/route";
vi.mock("server-only", () => ({}));
describe("planning authority matrix", () => {
  for (const resource of ["trip", "version", "event", "conversation", "proposal", "edit", "undo", "finalize", "run", "clarification"]) {
    it(`does not treat possession of a ${resource} ID as authority`, () => {
      expect(principalAllows({ accountUserId: null, guestSessionId: "owner" }, { accountUserId: "unrelated", guestSessionId: "other" })).toBe(false);
      expect(principalAllows({ accountUserId: "linked", guestSessionId: null }, { accountUserId: null, guestSessionId: "owner" })).toBe(false);
    });
  }
});

describe.skipIf(!hasIsolatedDatabaseConfiguration())("private guest HTTP access matrix", () => {
  let state: GuestApiFixture;
  beforeEach(async () => { state = await guestApiFixture(); }, 120000);
  afterEach(async () => { await state?.cleanup(); });
  it("allows current guest reads and denies unrelated proof before payload validation on every route", async () => {
    const tripId = state.trip.tripId, runId = state.run.id, other = await unrelatedGuest(state.fixture);
    const route = { params: Promise.resolve({ tripId }) }, runRoute = { params: Promise.resolve({ runId }) };
    const valid = await readTrip(state.request(`/api/v1/trips/${tripId}`), route);
    expect(valid.status).toBe(200); expect(valid.headers.get("cache-control")).toBe("private, no-store");
    const reads = [readTrip, versions, tripEvents, conversations];
    for (const handler of reads) {
      const response = await handler(state.request(`/api/v1/trips/${tripId}`, other), route);
      expect(response.status).toBe(404); expect(await response.text()).not.toContain("Synthetic London");
    }
    for (const handler of [edit, preview, undo, finalize]) {
      const response = await handler(state.request(`/api/v1/trips/${tripId}/commands/edit`, other, {}), route);
      expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    const proposalRoute = { params: Promise.resolve({ tripId, proposalId: crypto.randomUUID() }) };
    for (const handler of [accept, reject]) expect((await handler(state.request(`/api/v1/trips/${tripId}/proposals/unknown`, other, {}), proposalRoute)).status).toBe(404);
    for (const handler of [readRun, runEvents]) expect((await handler(state.request(`/api/v1/agent-runs/${runId}`, other), runRoute)).status).toBe(404);
    expect((await clarification(state.request(`/api/v1/agent-runs/${runId}/clarifications`, other, {}), runRoute)).status).toBe(404);
    expect((await revalidate(state.request(`/api/v1/trips/${tripId}/booking/revalidations`, state.credential, {}), route)).status).toBe(401);
    expect(await state.fixture.database.selectFrom("bookingAuthorizations").selectAll().execute()).toHaveLength(0);
    expect(await state.fixture.database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(0);
  });
});
