import { describe, expect, it } from "vitest";

import { lockPlanningAccess, lockPlanningTrip, lockSetupDraft } from "../../server/db/planning-access";

function fakeTransaction(tables: Record<string, unknown[]>) {
  const chain = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "selectAll", "where", "forUpdate"]) {
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

const liveSession = { id: "session-1", expiresAt: new Date(Date.now() + 60_000), revokedAt: null };
const expiredSession = { id: "session-1", expiresAt: new Date(Date.now() - 1), revokedAt: null };

describe("planning access locks", () => {
  it("locks the guest session before the principal and rejects lapsed authority", async () => {
    const live = fakeTransaction({
      guestPlanningSessions: [liveSession],
      planningPrincipals: [{ id: "principal-g", accountUserId: null, guestSessionId: "session-1" }],
    });
    await expect(lockPlanningAccess(live as never,
      { kind: "guest", guestSessionId: "session-1", planningOwnerId: "principal-g" })).resolves.toBeUndefined();

    const expired = fakeTransaction({
      guestPlanningSessions: [expiredSession],
      planningPrincipals: [{ id: "principal-g", accountUserId: null, guestSessionId: "session-1" }],
    });
    await expect(lockPlanningAccess(expired as never,
      { kind: "guest", guestSessionId: "session-1", planningOwnerId: "principal-g" }))
      .rejects.toMatchObject({ status: 404, code: "resource_not_found" });
  });

  it("rejects a principal that no longer matches the acting account", async () => {
    const mismatched = fakeTransaction({
      planningPrincipals: [{ id: "principal-a", accountUserId: "account-a", guestSessionId: null }],
    });
    await expect(lockPlanningAccess(mismatched as never,
      { kind: "account", accountUserId: "account-b", planningOwnerId: "principal-a" }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("scopes drafts and trips to the proven planning owner", async () => {
    const owned = fakeTransaction({
      setupDrafts: [{ id: "draft-1", planningOwnerId: "principal-a" }],
      trips: [{ id: "trip-1", ownerUserId: "principal-a" }],
    });
    await expect(lockSetupDraft(owned as never, "principal-a", "draft-1"))
      .resolves.toMatchObject({ id: "draft-1" });
    await expect(lockPlanningTrip(owned as never, "principal-a", "trip-1"))
      .resolves.toMatchObject({ id: "trip-1" });

    const foreign = fakeTransaction({
      setupDrafts: [{ id: "draft-1", planningOwnerId: "principal-b" }],
      trips: [{ id: "trip-1", ownerUserId: "principal-b" }],
    });
    await expect(lockSetupDraft(foreign as never, "principal-a", "draft-1"))
      .rejects.toMatchObject({ status: 404 });
    await expect(lockPlanningTrip(foreign as never, "principal-a", "trip-1"))
      .rejects.toMatchObject({ status: 404 });
  });
});
