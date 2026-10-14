// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptySetupDraft, setupDraftPayloadSchema } from "../../components/trip-setup/draft-schema";
import { saveSetupDraftSchema } from "../../server/db/planning-schema";
import { initialTripSnapshot } from "../../domain/trip/create";
import { placeLookupInputSchema } from "../../domain/trip/destination";
import { hasIsolatedDatabaseConfiguration } from "../helpers/database";
import { guestApiFixture, unrelatedGuest, type GuestApiFixture } from "../helpers/guest-api";
import { POST as allocate } from "../../app/api/v1/setup-drafts/route";
import { GET as readDraft, PATCH as saveDraft } from "../../app/api/v1/setup-drafts/[draftId]/route";
vi.mock("server-only", () => ({}));

describe("guest setup boundaries", () => {
  it("accepts incomplete saved input but rejects it as a submitted trip", () => {
    const payload = emptySetupDraft();
    expect(setupDraftPayloadSchema.parse(payload).duration.idealDays).toBeNull();
    expect(() => initialTripSnapshot({ requestId: crypto.randomUUID(), title: payload.title,
      currency: payload.currency, snapshot: payload }, new Date())).toThrow();
  });
  it("rejects client ownership and missing optimistic concurrency", () => {
    expect(saveSetupDraftSchema.safeParse({ requestId: crypto.randomUUID(), payload: emptySetupDraft() }).success).toBe(false);
    expect(saveSetupDraftSchema.safeParse({ requestId: crypto.randomUUID(), expectedRevision: 1,
      currentStep: "origin", payload: emptySetupDraft(), ownerUserId: "attacker" }).success).toBe(false);
  });
  it("allows empty lookup only for country-restricted cities", () => {
    expect(placeLookupInputSchema.safeParse({ query: "", countryCode: "JP", kind: "city" }).success).toBe(true);
    expect(placeLookupInputSchema.safeParse({ query: "" }).success).toBe(false);
    expect(placeLookupInputSchema.safeParse({ query: "Tokyo", countryCode: "JPN" }).success).toBe(false);
  });
});

describe.skipIf(!hasIsolatedDatabaseConfiguration())("draft HTTP envelopes and origin protection", () => {
  let state: GuestApiFixture;
  beforeEach(async () => { state = await guestApiFixture(); }, 120000);
  afterEach(async () => { await state?.cleanup(); });
  it("returns private allocation replay, denies inaccessible drafts and rejects cross-origin writes", async () => {
    const path = "/api/v1/setup-drafts", requestId = crypto.randomUUID();
    const first = await allocate(state.request(path, state.credential, { requestId }));
    const second = await allocate(state.request(path, state.credential, { requestId }));
    expect(first.status).toBe(201); expect(second.status).toBe(200);
    const original = await first.json() as { draftId: string };
    expect((await second.json() as { draftId: string }).draftId).toBe(original.draftId);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    const route = { params: Promise.resolve({ draftId: original.draftId }) };
    expect((await readDraft(state.request(`${path}/${original.draftId}`, await unrelatedGuest(state.fixture)), route)).status).toBe(404);
    const forged = new Request(`http://planning.test${path}/${original.draftId}`, { method: "PATCH", headers: { origin: "https://attacker.invalid", "content-type": "application/json" }, body: "{}" });
    expect((await saveDraft(forged, route)).status).toBe(403);
  });
});
