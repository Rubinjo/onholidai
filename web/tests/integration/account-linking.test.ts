// @vitest-environment node
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { describe, expect, it, vi } from "vitest";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
import { createPlanningSession } from "../../server/auth/planning-session";
import { allocateWizardPrincipal } from "../../server/db/planning-principal-repository";
import { linkTrip } from "../../server/auth/link-trip";
import { resolvePlanningActor } from "../../server/auth/planning-actor";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { RunRepository, runContext } from "../../server/agent-client/run-repository";
vi.mock("server-only", () => ({}));
describe.skipIf(!hasIsolatedDatabaseConfiguration())("selected principal linking", () => {
  it("serializes competing claims, retains version and revokes former guest authority without booking", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const { session } = await createPlanningSession(database), identity = { accountUserId: null, guestSessionId: session.id };
      const principal = await allocateWizardPrincipal(database, identity), unrelated = await allocateWizardPrincipal(database, identity);
      const tripId = randomUUID(), intentId = randomUUID(), accounts = [randomUUID(), randomUUID()];
      for (const account of accounts) await sql`INSERT INTO app."user" (id,name,email) VALUES (${account},'Synthetic',${`${account}@example.invalid`})`.execute(database);
      await database.insertInto("trips").values({ id: tripId, ownerUserId: principal, title: "Synthetic linking fixture", currency: "GBP", lifecycleState: "draft" }).execute();
      const snapshot = createSyntheticTripSnapshot();
      await database.insertInto("tripVersions").values({ tripId, version: 1, previousVersion: null, schemaVersion: 1, snapshot,
        initiatingActor: "user", initiatingRequestId: randomUUID(), proposalId: null,
        changeSummary: sql<string[]>`'["Synthetic fixture"]'::jsonb`, inverseOperation: null, nonReversibleReason: "Initial fixture" }).execute();
      const run = await new RunRepository(database).reserve({ userId: principal, tripId, requestId: randomUUID(), baseTripVersion: 1,
        purpose: "initial_estimate", message: "Synthetic research" });
      await database.updateTable("trips").set({ lifecycleState: "finalized" }).where("id", "=", tripId).execute();
      const now = new Date();
      await database.insertInto("bookingIntents").values({ id: intentId, tripId, planningOwnerId: principal, guestSessionId: session.id,
        requestId: randomUUID(), fingerprint: "a".repeat(64), action: "review_booking", state: "pending", createdAt: now,
        expiresAt: new Date(now.getTime() + 1800000), consumedByUserId: null, consumedAt: null }).execute();
      const results = await Promise.allSettled(accounts.map((accountUserId) => linkTrip(database,
        { accountUserId, guestSessionId: session.id }, intentId, { requestId: randomUUID() })));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const owner = await database.selectFrom("planningPrincipals").selectAll().where("id", "=", principal).executeTakeFirstOrThrow();
      expect(owner.guestSessionId).toBeNull();
      expect((await database.selectFrom("trips").selectAll().where("id", "=", tripId).executeTakeFirstOrThrow()).currentVersion).toBe(1);
      expect((await database.selectFrom("planningPrincipals").selectAll().where("id", "=", unrelated).executeTakeFirstOrThrow()).guestSessionId).toBe(session.id);
      await expect(resolvePlanningActor(database, principal, identity)).rejects.toMatchObject({ status: 404 });
      expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(0);
      expect(await database.selectFrom("bookingAuthorizations").selectAll().execute()).toHaveLength(0);
      const revoked = await database.selectFrom("agentRuns").selectAll().where("id", "=", run.id).executeTakeFirstOrThrow();
      expect(revoked.planningAccessRevokedAt).not.toBeNull(); expect(revoked.status).toBe("failed");
      expect(revoked.requestId).toBe(run.requestId);
      await expect(new RunRepository(database).readScoped(runContext(run), run.id)).rejects.toMatchObject({ code: "planning_run_access_revoked" });
      expect((await database.selectFrom("tripVersions").select("snapshot").where("tripId", "=", tripId).executeTakeFirstOrThrow()).snapshot).toEqual(snapshot);
      const replay = await linkTrip(database, { accountUserId: owner.accountUserId, guestSessionId: null }, intentId, { requestId: randomUUID() }, new Date(Date.now() + 31 * 86400000));
      expect(replay.tripId).toBe(tripId); expect(replay.replayed).toBe(true);
    });
  });
});
