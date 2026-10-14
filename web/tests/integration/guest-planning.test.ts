// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIsolatedTestDatabase, hasIsolatedDatabaseConfiguration, type IsolatedTestDatabase } from "../helpers/database";
import { createPlanningSession, revokePlanningSession } from "../../server/auth/planning-session";
import { SetupDraftRepository } from "../../server/db/setup-draft-repository";
import { resolvePlanningActor } from "../../server/auth/planning-actor";
import { RunRepository } from "../../server/agent-client/run-repository";
import { validSetupPayload } from "../helpers/guest-setup";
import { reviewSetupDraftRetention } from "../../server/privacy/retention";
vi.mock("server-only", () => ({}));
describe.skipIf(!hasIsolatedDatabaseConfiguration())("guest recovery and revocation", () => {
  let fixture: IsolatedTestDatabase;
  beforeEach(async () => { fixture = await createIsolatedTestDatabase(); }, 120000);
  afterEach(async () => { await fixture?.cleanup(); });
  it("retains acknowledged private draft data after authority is revoked", async () => {
    const created = await createPlanningSession(fixture.database), identity = { accountUserId: null, guestSessionId: created.session.id };
    const repository = new SetupDraftRepository(fixture.database, identity), { draft } = await repository.allocate(randomUUID());
    await repository.save(draft.draftId, { requestId: randomUUID(), expectedRevision: 1, currentStep: "origin", payload: { ...draft.payload, title: "Preserved" } });
    const owner = await fixture.database.selectFrom("setupDrafts").select("planningOwnerId").where("id", "=", draft.draftId).executeTakeFirstOrThrow();
    await revokePlanningSession(fixture.database, created.credential);
    await expect(resolvePlanningActor(fixture.database, owner.planningOwnerId, identity)).rejects.toMatchObject({ status: 404 });
    expect((await fixture.database.selectFrom("setupDrafts").select("payload").where("id", "=", draft.draftId).executeTakeFirstOrThrow()).payload.title).toBe("Preserved");
  });
  it("enforces session-wide concurrency, makes replay free, and releases terminal work", async () => {
    const { session } = await createPlanningSession(fixture.database);
    const drafts = new SetupDraftRepository(fixture.database, { accountUserId: null, guestSessionId: session.id });
    const trips = [];
    for (let index = 0; index < 2; index++) {
      const { draft } = await drafts.allocate(randomUUID());
      const saved = await drafts.save(draft.draftId, { requestId: randomUUID(), expectedRevision: 1, currentStep: "review", payload: validSetupPayload() });
      trips.push(await drafts.submit(draft.draftId, { expectedRevision: saved.revision }));
    }
    const owners = await fixture.database.selectFrom("trips").select(["id", "ownerUserId"]).execute();
    const runs = new RunRepository(fixture.database), commands = trips.map((trip) => ({ userId: owners.find((entry) => entry.id === trip.tripId)!.ownerUserId,
      tripId: trip.tripId, requestId: trip.researchRequestId, baseTripVersion: 1, purpose: "initial_estimate", message: "Synthetic estimate" }));
    const accepted = await Promise.all(commands.map((command) => runs.reserve(command)));
    expect((await runs.reserve(commands[0])).id).toBe(accepted[0].id);
    await expect(runs.reserve({ ...commands[0], requestId: randomUUID() })).rejects.toMatchObject({ status: 429 });
    await fixture.database.updateTable("agentRuns").set({ status: "failed", leaseExpiresAt: null, completedAt: new Date(), errorCategory: "interrupted" }).where("id", "=", accepted[0].id).execute();
    const fresh = await runs.reserve({ ...commands[0], requestId: randomUUID() });
    expect(fresh.id).not.toBe(accepted[0].id);
    expect(await fixture.database.selectFrom("trips").selectAll().execute()).toHaveLength(2);
  });
  it("reviews old incomplete drafts without automatic deletion", async () => {
    const { session } = await createPlanningSession(fixture.database), repository = new SetupDraftRepository(fixture.database, { accountUserId: null, guestSessionId: session.id });
    const { draft } = await repository.allocate(randomUUID());
    const review = await reviewSetupDraftRetention(fixture.database, new Date(Date.now() + 3 * 366 * 86400000));
    expect(review.find((entry) => entry.draftId === draft.draftId)?.status).toBe("review_required");
    expect(await fixture.database.selectFrom("setupDrafts").selectAll().execute()).toHaveLength(1);
  });
});
