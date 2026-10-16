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
import { POST as bootstrapSession } from "../../app/api/v1/planning-session/route";
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
  it("bootstraps a protected guest session and renews the presented credential", async () => {
    const allocated = await bootstrapSession(state.request("/api/v1/planning-session", "unused", { requestId: crypto.randomUUID() }));
    expect(allocated.status).toBe(200);
    expect(allocated.headers.get("cache-control")).toBe("private, no-store");
    const cookie = allocated.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    const credential = cookie.split(";")[0].split("=")[1];
    expect(credential).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const renewed = await bootstrapSession(state.request("/api/v1/planning-session", credential, { requestId: crypto.randomUUID() }));
    expect(renewed.status).toBe(200);
    expect(JSON.parse(await renewed.text()).kind).toBe("guest");
    const crossOrigin = new Request("http://planning.test/api/v1/planning-session", { method: "POST",
      headers: { origin: "https://attacker.invalid", "content-type": "application/json" },
      body: JSON.stringify({ requestId: crypto.randomUUID() }) });
    expect((await bootstrapSession(crossOrigin)).status).toBe(403);
  });
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
