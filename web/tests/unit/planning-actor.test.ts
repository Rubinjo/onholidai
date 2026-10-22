import { describe, expect, it } from "vitest";

import {
  planningNotFound,
  principalAllows,
  resolveBookingActor,
  resolvePlanningActor,
} from "../../server/auth/planning-actor";
import { ProblemError } from "../../server/errors";

const now = new Date("2030-01-01T00:00:00Z");
const liveSession = { expiresAt: new Date(Date.now() + 60_000), revokedAt: null };
const expiredSession = { expiresAt: new Date(Date.now() - 1), revokedAt: null };

function fakeDatabase(tables: Record<string, unknown[]>) {
  const chain = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "selectAll", "where", "innerJoin", "leftJoin", "forUpdate"]) {
      builder[method] = () => builder;
    }
    return builder;
  };
  return {
    selectFrom: (name: string) => {
      const builder = chain();
      builder.executeTakeFirst = async () => (tables[name] ?? [])[0];
      builder.execute = async () => tables[name] ?? [];
      return builder;
    },
  };
}

describe("current planning principal binding", () => {
  it("requires current account binding after linking even with original guest proof", () => {
    const linked = { accountUserId: "account", guestSessionId: null };
    expect(
      principalAllows(linked, { accountUserId: "account", guestSessionId: "old-session" }),
    ).toBe(true);
    expect(principalAllows(linked, { accountUserId: "other", guestSessionId: "old-session" })).toBe(
      false,
    );
    expect(principalAllows(linked, { accountUserId: null, guestSessionId: "old-session" })).toBe(
      false,
    );
  });
  it("does not let authentication alone claim an unlinked guest resource", () => {
    const guest = { accountUserId: null, guestSessionId: "session" };
    expect(principalAllows(guest, { accountUserId: "account", guestSessionId: null })).toBe(false);
    expect(principalAllows(guest, { accountUserId: null, guestSessionId: "other" })).toBe(false);
    expect(principalAllows(guest, { accountUserId: "account", guestSessionId: "session" })).toBe(
      true,
    );
  });
});

describe("non-disclosing planning denial", () => {
  it("reports unknown resources without extra detail", () => {
    try {
      planningNotFound();
    } catch (error) {
      expect(error).toBeInstanceOf(ProblemError);
      const problem = error as ProblemError;
      expect(problem.status).toBe(404);
      expect(problem.code).toBe("resource_not_found");
      expect(problem.detail).toBeUndefined();
      return;
    }
    throw new Error("planningNotFound should reject unknown resources");
  });
});

describe("server-produced planning actors", () => {
  it("resolves the account actor from a matching account principal", async () => {
    const database = fakeDatabase({
      planningPrincipals: [{ id: "principal-a", accountUserId: "account-a", guestSessionId: null }],
    });
    await expect(
      resolvePlanningActor(database as never, "principal-a", {
        accountUserId: "account-a",
        guestSessionId: null,
      }),
    ).resolves.toEqual({
      kind: "account",
      planningOwnerId: "principal-a",
      accountUserId: "account-a",
    });
  });

  it("resolves the guest actor only while its session is live", async () => {
    const database = fakeDatabase({
      planningPrincipals: [{ id: "principal-g", accountUserId: null, guestSessionId: "session-1" }],
      guestPlanningSessions: [liveSession],
    });
    await expect(
      resolvePlanningActor(database as never, "principal-g", {
        accountUserId: null,
        guestSessionId: "session-1",
      }),
    ).resolves.toEqual({
      kind: "guest",
      planningOwnerId: "principal-g",
      guestSessionId: "session-1",
    });
  });

  it("denies revoked guest sessions and mismatched authorities", async () => {
    const revoked = fakeDatabase({
      planningPrincipals: [{ id: "principal-g", accountUserId: null, guestSessionId: "session-1" }],
      guestPlanningSessions: [{ ...liveSession, revokedAt: now }],
    });
    await expect(
      resolvePlanningActor(revoked as never, "principal-g", {
        accountUserId: null,
        guestSessionId: "session-1",
      }),
    ).rejects.toMatchObject({ status: 404, code: "resource_not_found" });

    const expired = fakeDatabase({
      planningPrincipals: [{ id: "principal-g", accountUserId: null, guestSessionId: "session-1" }],
      guestPlanningSessions: [expiredSession],
    });
    await expect(
      resolvePlanningActor(expired as never, "principal-g", {
        accountUserId: null,
        guestSessionId: "session-1",
      }),
    ).rejects.toMatchObject({ status: 404 });

    const mismatched = fakeDatabase({
      planningPrincipals: [{ id: "principal-g", accountUserId: null, guestSessionId: "session-1" }],
      guestPlanningSessions: [liveSession],
    });
    await expect(
      resolvePlanningActor(mismatched as never, "principal-g", {
        accountUserId: "account-a",
        guestSessionId: null,
      }),
    ).rejects.toMatchObject({ status: 404 });

    const unknown = fakeDatabase({});
    await expect(
      resolvePlanningActor(unknown as never, "missing", {
        accountUserId: "account-a",
        guestSessionId: null,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("account-only booking authority", () => {
  it("resolves the booking actor only through the account-owned principal", async () => {
    const database = fakeDatabase({ trips: [{ ownerUserId: "principal-a" }] });
    await expect(resolveBookingActor(database as never, "trip-1", "account-a")).resolves.toEqual({
      accountUserId: "account-a",
      planningOwnerId: "principal-a",
    });
  });

  it("denies booking when no principal links the trip to the account", async () => {
    const guestOwned = fakeDatabase({ trips: [] });
    await expect(
      resolveBookingActor(guestOwned as never, "trip-1", "account-a"),
    ).rejects.toMatchObject({
      status: 404,
      code: "resource_not_found",
    });
  });
});
