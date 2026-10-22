import { beforeAll, describe, expect, it, vi } from "vitest";

import type { AuthorizationSession } from "../../server/auth/authorize";

vi.mock("server-only", () => ({}));

type AuthorizationModule = typeof import("../../server/auth/authorize");

let authorization: AuthorizationModule;

beforeAll(async () => {
  authorization = await import("../../server/auth/authorize");
});

function session(userId: string, internalTeamRole?: unknown) {
  return {
    session: {} as AuthorizationSession["session"],
    user: { id: userId, internalTeamRole },
  };
}

describe("ownership authorization", () => {
  it("allows an owner", () => {
    const actor = session("user-1");

    expect(authorization.requireOwnerOrInternalTeamRole(actor, "user-1")).toBe(actor.user);
  });

  it("rejects an unauthenticated request", () => {
    expect(() => authorization.requireOwnerOrInternalTeamRole(null, "user-1")).toThrow(
      expect.objectContaining({ code: "UNAUTHENTICATED", status: 401 }),
    );
  });

  it("rejects a different user", () => {
    expect(() => authorization.requireOwnerOrInternalTeamRole(session("user-2"), "user-1")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
    );
  });
});

describe("internal team authorization", () => {
  it("allows only an explicitly permitted internal role", () => {
    const actor = session("support-user", "support");

    expect(authorization.requireOwnerOrInternalTeamRole(actor, "user-1", ["support"])).toBe(
      actor.user,
    );
  });

  it("denies an internal role when no bypass roles are allowed", () => {
    expect(() =>
      authorization.requireOwnerOrInternalTeamRole(session("admin-user", "admin"), "user-1"),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });

  it("rejects unknown and unpermitted role values", () => {
    expect(() =>
      authorization.requireInternalTeamRole(session("user-2", "superuser"), ["support"]),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
    expect(() =>
      authorization.requireInternalTeamRole(session("user-3", "operations"), ["admin"]),
    ).toThrow(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
