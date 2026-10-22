// @vitest-environment node
import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
import { createPlanningSession } from "../../server/auth/planning-session";
import { allocateWizardPrincipal } from "../../server/db/planning-principal-repository";
import { linkTrip } from "../../server/auth/link-trip";
import { resolvePlanningActor } from "../../server/auth/planning-actor";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { RunRepository, runContext } from "../../server/agent-client/run-repository";
import {
  guestApiFixture,
  registerFixtureAccount,
  type GuestApiFixture,
} from "../helpers/guest-api";
import { previewEdit } from "../../domain/trip/edit";
import { POST as editRoute } from "../../app/api/v1/trips/[tripId]/commands/edit/route";
import { SetupDraftRepository } from "../../server/db/setup-draft-repository";

vi.mock("server-only", () => ({}));
describe.skipIf(!hasIsolatedDatabaseConfiguration())("selected principal linking", () => {
  it("serializes competing claims, retains version and revokes former guest authority without booking", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const { session } = await createPlanningSession(database),
        identity = { accountUserId: null, guestSessionId: session.id };
      const principal = await allocateWizardPrincipal(database, identity),
        unrelated = await allocateWizardPrincipal(database, identity);
      const tripId = randomUUID(),
        intentId = randomUUID(),
        accounts = [randomUUID(), randomUUID()];
      for (const account of accounts)
        await sql`INSERT INTO app."user" (id,name,email) VALUES (${account},'Synthetic',${`${account}@example.invalid`})`.execute(
          database,
        );
      await database
        .insertInto("trips")
        .values({
          id: tripId,
          ownerUserId: principal,
          title: "Synthetic linking fixture",
          currency: "GBP",
          lifecycleState: "draft",
        })
        .execute();
      const snapshot = createSyntheticTripSnapshot();
      await database
        .insertInto("tripVersions")
        .values({
          tripId,
          version: 1,
          previousVersion: null,
          schemaVersion: 1,
          snapshot,
          initiatingActor: "user",
          initiatingRequestId: randomUUID(),
          proposalId: null,
          changeSummary: sql<string[]>`'["Synthetic fixture"]'::jsonb`,
          inverseOperation: null,
          nonReversibleReason: "Initial fixture",
        })
        .execute();
      const run = await new RunRepository(database).reserve({
        userId: principal,
        tripId,
        requestId: randomUUID(),
        baseTripVersion: 1,
        purpose: "initial_estimate",
        message: "Synthetic research",
      });
      await database
        .updateTable("trips")
        .set({ lifecycleState: "finalized" })
        .where("id", "=", tripId)
        .execute();
      const now = new Date();
      await database
        .insertInto("bookingIntents")
        .values({
          id: intentId,
          tripId,
          planningOwnerId: principal,
          guestSessionId: session.id,
          requestId: randomUUID(),
          fingerprint: "a".repeat(64),
          action: "review_booking",
          state: "pending",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 1800000),
          consumedByUserId: null,
          consumedAt: null,
        })
        .execute();
      const results = await Promise.allSettled(
        accounts.map((accountUserId) =>
          linkTrip(database, { accountUserId, guestSessionId: session.id }, intentId, {
            requestId: randomUUID(),
          }),
        ),
      );
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const owner = await database
        .selectFrom("planningPrincipals")
        .selectAll()
        .where("id", "=", principal)
        .executeTakeFirstOrThrow();
      expect(owner.guestSessionId).toBeNull();
      expect(
        (
          await database
            .selectFrom("trips")
            .selectAll()
            .where("id", "=", tripId)
            .executeTakeFirstOrThrow()
        ).currentVersion,
      ).toBe(1);
      expect(
        (
          await database
            .selectFrom("planningPrincipals")
            .selectAll()
            .where("id", "=", unrelated)
            .executeTakeFirstOrThrow()
        ).guestSessionId,
      ).toBe(session.id);
      await expect(resolvePlanningActor(database, principal, identity)).rejects.toMatchObject({
        status: 404,
      });
      expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(
        0,
      );
      expect(await database.selectFrom("bookingAuthorizations").selectAll().execute()).toHaveLength(
        0,
      );
      const revoked = await database
        .selectFrom("agentRuns")
        .selectAll()
        .where("id", "=", run.id)
        .executeTakeFirstOrThrow();
      expect(revoked.planningAccessRevokedAt).not.toBeNull();
      expect(revoked.status).toBe("failed");
      expect(revoked.requestId).toBe(run.requestId);
      await expect(
        new RunRepository(database).readScoped(runContext(run), run.id),
      ).rejects.toMatchObject({ code: "planning_run_access_revoked" });
      expect(
        (
          await database
            .selectFrom("tripVersions")
            .select("snapshot")
            .where("tripId", "=", tripId)
            .executeTakeFirstOrThrow()
        ).snapshot,
      ).toEqual(snapshot);
      const replay = await linkTrip(
        database,
        { accountUserId: owner.accountUserId, guestSessionId: null },
        intentId,
        { requestId: randomUUID() },
        new Date(Date.now() + 31 * 86400000),
      );
      expect(replay.tripId).toBe(tripId);
      expect(replay.replayed).toBe(true);
    });
  });
});

describe.skipIf(!hasIsolatedDatabaseConfiguration())(
  "linking overlaps browser edits and research",
  () => {
    let state: GuestApiFixture;
    beforeEach(async () => {
      state = await guestApiFixture();
    }, 120000);
    afterEach(async () => {
      await state?.cleanup();
    });
    it("preserves an acknowledged edit or denies it after linking, revokes callbacks and never duplicates consent", async () => {
      const database = state.fixture.database,
        owner = state.run.ownerUserId,
        account = await registerFixtureAccount(state);
      const before = await database
        .selectFrom("tripVersions")
        .select("snapshot")
        .where("tripId", "=", state.trip.tripId)
        .executeTakeFirstOrThrow();
      const input = {
        requestId: randomUUID(),
        expectedVersion: 1,
        operations: [{ operation: "replace", target: "/preferences/pace", value: 60 }],
      };
      const review = await previewEdit(
        database,
        owner,
        state.trip.tripId,
        input,
        state.application.planningProviders,
      );
      const now = new Date(),
        intentId = randomUUID();
      await database
        .insertInto("bookingIntents")
        .values({
          id: intentId,
          tripId: state.trip.tripId,
          planningOwnerId: owner,
          guestSessionId: state.session.id,
          requestId: randomUUID(),
          fingerprint: "c".repeat(64),
          action: "review_booking",
          state: "pending",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 1800000),
          consumedAt: null,
          consumedByUserId: null,
        })
        .execute();
      const draftRepository = new SetupDraftRepository(database, {
        accountUserId: null,
        guestSessionId: state.session.id,
      });
      const save = draftRepository
        .save(state.draft.draftId, {
          requestId: randomUUID(),
          expectedRevision: state.draft.revision,
          currentStep: "review",
          payload: state.draft.payload,
        })
        .catch((failure: unknown) => failure);
      const [edited, linked] = await Promise.all([
        editRoute(
          state.request(`/api/v1/trips/${state.trip.tripId}/commands/edit`, state.credential, {
            ...input,
            impactFingerprint: review.impactFingerprint,
          }),
          { params: Promise.resolve({ tripId: state.trip.tripId }) },
        ),
        linkTrip(
          database,
          { accountUserId: account.id, guestSessionId: state.session.id },
          intentId,
          { requestId: randomUUID() },
        ),
      ]);
      expect([200, 404]).toContain(edited.status);
      expect(await save).toMatchObject({ status: expect.any(Number) });
      const trip = await database
        .selectFrom("trips")
        .selectAll()
        .where("id", "=", state.trip.tripId)
        .executeTakeFirstOrThrow();
      expect(trip.currentVersion).toBe(edited.status === 200 ? 2 : 1);
      expect(linked.tripId).toBe(state.trip.tripId);
      expect(
        (
          await database
            .selectFrom("tripVersions")
            .select("snapshot")
            .where("tripId", "=", trip.id)
            .where("version", "=", 1)
            .executeTakeFirstOrThrow()
        ).snapshot,
      ).toEqual(before.snapshot);
      expect(
        await resolvePlanningActor(database, owner, {
          accountUserId: account.id,
          guestSessionId: null,
        }),
      ).toMatchObject({ kind: "account", planningOwnerId: owner });
      await expect(
        new RunRepository(database).readScoped(runContext(state.run), state.run.id),
      ).rejects.toMatchObject({ code: "planning_run_access_revoked" });
      await expect(
        resolvePlanningActor(database, owner, {
          accountUserId: null,
          guestSessionId: state.session.id,
        }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await database.selectFrom("planningAccountLinks").selectAll().execute()).toHaveLength(
        1,
      );
      expect(await database.selectFrom("bookingAuthorizations").selectAll().execute()).toHaveLength(
        0,
      );
      expect(await database.selectFrom("bookingTransactions").selectAll().execute()).toHaveLength(
        0,
      );
    });
  },
);
