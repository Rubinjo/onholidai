// @vitest-environment node
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { apiResponse, browserUser, internalActor, planningContext, requestJson, requirePlanningActor } from "../../server/api";
import { createServiceToken } from "../../server/agent-client/credentials";
import { createApplication } from "../../server/application";
import type { getSession } from "../../server/auth/auth";
import { planningProblems, problemResponse } from "../../server/errors";

vi.mock("server-only", () => ({}));

describe("API boundary", () => {
  it("requires browser authentication and the configured origin for mutation", async () => {
    const application = createApplication({ NODE_ENV: "test" });
    const dependencies = { application: () => application, session: vi.fn<typeof getSession>().mockResolvedValue(null) };
    try {
      await expect(browserUser(application, new Request("http://localhost/api/v1/trips"), dependencies))
        .rejects.toMatchObject({ status: 401 });
      await expect(browserUser(application, new Request("http://localhost/api/v1/trips", {
        method: "POST", headers: { origin: "https://unrelated.example" },
      }), dependencies)).rejects.toMatchObject({ status: 403 });
    } finally { await application.shutdown(); }
  });

  it("binds internal reads to the signed actor and denies service keys on diagnostics", async () => {
    const application = createApplication({ NODE_ENV: "test" });
    const context = { userId: "10000000-0000-4000-8000-000000000001",
      tripId: "10000000-0000-4000-8000-000000000002",
      requestId: "10000000-0000-4000-8000-000000000003", baseTripVersion: 1 };
    const token = createServiceToken({ ...context, audience: "web", scopes: ["trip:read", "pricing:read"],
      secret: application.config.SERVICE_TOKEN_SECRET });
    const request = new Request("http://localhost", { headers: { authorization: `Bearer ${token}`,
      "x-user-id": context.userId, "x-request-id": context.requestId } });
    try {
      expect(internalActor(application, request, context.tripId, 1, "trip:read").userId).toBe(context.userId);
      expect(() => internalActor(application, request, context.tripId, 2, "trip:read")).toThrow();
      expect(() => internalActor(application, request, context.tripId, 1, "pricing:read", true)).toThrow();
    } finally { await application.shutdown(); }
  });
  it("returns safe validation and driver failures with correlation and no-cache headers", async () => {
    const application = createApplication({ NODE_ENV: "test" });
    const dependencies = { application: () => application, session: vi.fn<typeof getSession>() };
    try {
      const request = new Request("http://localhost/api/v1/trips", {
        headers: { "x-correlation-id": "synthetic-correlation-id" },
      });
      const validation = await apiResponse(request, async () => z.uuid().parse("private traveller facts"), { dependencies });
      expect(validation.status).toBe(422);
      expect(JSON.stringify(await validation.json())).not.toContain("private traveller facts");
      const driver = await apiResponse(request, async () => { throw new Error("supplier amount 991234 and secret"); }, { dependencies });
      expect(driver.status).toBe(500);
      expect(JSON.stringify(await driver.json())).not.toContain("991234");
      expect(driver.headers.get("Cache-Control")).toBe("private, no-store");
      expect(driver.headers.has("x-correlation-id")).toBe(true);
    } finally { await application.shutdown(); }
  });

  it("resolves planning proof without requiring an account session", async () => {
    const application = createApplication({ NODE_ENV: "test" });
    const anonymous = { application: () => application, session: vi.fn<typeof getSession>().mockResolvedValue(null) };
    const signedIn = { application: () => application,
      session: vi.fn<typeof getSession>().mockResolvedValue({ user: { id: "account-a" } } as never) };
    try {
      await expect(planningContext(application, new Request("http://localhost/api/v1/setup-drafts"), anonymous))
        .resolves.toEqual({ credential: null, production: false, identity: { accountUserId: null, guestSessionId: null } });
      await expect(planningContext(application, new Request("http://localhost/api/v1/setup-drafts"), signedIn))
        .resolves.toMatchObject({ identity: { accountUserId: "account-a", guestSessionId: null } });
      await expect(requirePlanningActor(application, new Request("http://localhost/api/v1/setup-drafts", {
        method: "POST", headers: { origin: "https://unrelated.example" },
      }), "principal-a", anonymous)).rejects.toMatchObject({ status: 403 });
    } finally { await application.shutdown(); }
  });

  it("exposes safe planning problem codes and retry guidance", async () => {
    expect(planningProblems.resourceNotFound()).toMatchObject({ status: 404, code: "resource_not_found" });
    expect(planningProblems.guestSessionUnavailable()).toMatchObject({ status: 401, code: "guest_session_unavailable" });
    expect(planningProblems.draftRevisionConflict()).toMatchObject({ status: 409, code: "draft_revision_conflict" });
    expect(planningProblems.draftAlreadySubmitted()).toMatchObject({ status: 409, code: "draft_already_submitted" });
    expect(planningProblems.bookingIntentExpired()).toMatchObject({ status: 410, code: "booking_intent_expired" });
    expect(planningProblems.planningRunAccessRevoked()).toMatchObject({ status: 403, code: "planning_run_access_revoked" });
    const limited = problemResponse(planningProblems.guestResearchLimited(90), "correlation");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("90");
    expect((await limited.json() as { code: string }).code).toBe("guest_research_limited");
  });

  it("rejects missing, non-JSON and oversized bodies", async () => {
    await expect(requestJson(new Request("http://localhost", { method: "POST" }))).rejects.toMatchObject({ status: 415 });
    await expect(requestJson(new Request("http://localhost", { method: "POST",
      headers: { "content-type": "application/json" }, body: "x".repeat(262_145) })))
      .rejects.toMatchObject({ status: 413 });
    expect(await requestJson(new Request("http://localhost", { method: "POST",
      headers: { "content-type": "application/json" }, body: '{"requestId":"synthetic"}' })))
      .toEqual({ requestId: "synthetic" });
  });
});
