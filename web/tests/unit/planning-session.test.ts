import { describe, expect, it } from "vitest";

import {
  digestPlanningCredential,
  planningCookie,
  planningCredential,
  PLANNING_IDLE_MS,
  validPlanningSession,
} from "../../server/auth/planning-session";

describe("opaque planning authority", () => {
  const now = new Date("2030-01-01T00:00:00Z");
  it("stores a digest distinct from the credential and requires live authority", () => {
    const credential = "synthetic-credential-with-32-bytes";
    expect(digestPlanningCredential(credential)).toMatch(/^[a-f0-9]{64}$/);
    expect(digestPlanningCredential(credential)).not.toContain(credential);
    expect(
      validPlanningSession({ expiresAt: new Date(now.getTime() + 1), revokedAt: null }, now),
    ).toBe(true);
    expect(validPlanningSession({ expiresAt: now, revokedAt: null }, now)).toBe(false);
    expect(
      validPlanningSession({ expiresAt: new Date(now.getTime() + 1), revokedAt: now }, now),
    ).toBe(false);
  });
  it("uses host-only protected production cookies without leaking authority in URLs", () => {
    const cookie = planningCookie("opaque", true);
    expect(cookie).toContain("__Host-onholidai-planning=opaque;");
    for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/", "Secure"])
      expect(cookie).toContain(flag);
    expect(cookie).not.toContain("Domain=");
    expect(planningCookie("opaque", false)).toContain("onholidai-planning-dev=");
  });

  it("renews valid authority by the fixed 30-day idle window", () => {
    expect(PLANNING_IDLE_MS).toBe(30 * 24 * 60 * 60 * 1000);
    expect(planningCookie("opaque", true)).toContain(`Max-Age=${PLANNING_IDLE_MS / 1000}`);
  });

  it("accepts only an opaque base64url credential from the named cookie", () => {
    const credential = "A".repeat(43);
    const headers = new Headers({
      cookie: `theme=dark; onholidai-planning-dev=${credential}; other=x`,
    });
    expect(planningCredential(headers, false)).toBe(credential);
    expect(
      planningCredential(new Headers({ cookie: "onholidai-planning-dev=plain text" }), false),
    ).toBeNull();
    expect(
      planningCredential(new Headers({ cookie: "onholidai-planning-dev=too-short" }), false),
    ).toBeNull();
    expect(
      planningCredential(new Headers({ cookie: `unrelated=${credential}` }), false),
    ).toBeNull();
    expect(
      planningCredential(new Headers({ cookie: `onholidai-planning-dev=${credential}` }), true),
    ).toBeNull();
  });
});
