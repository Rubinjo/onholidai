// @vitest-environment node
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createIsolatedTestDatabase,
  hasIsolatedDatabaseConfiguration,
  type IsolatedTestDatabase,
} from "../helpers/database";
import { createPlanningSession } from "../../server/auth/planning-session";
import { SetupDraftRepository } from "../../server/db/setup-draft-repository";
import { validSetupPayload } from "../helpers/guest-setup";

vi.mock("server-only", () => ({}));

describe.skipIf(!hasIsolatedDatabaseConfiguration())("persisted guest drafts", () => {
  let fixture: IsolatedTestDatabase;
  let repository: SetupDraftRepository;
  beforeEach(async () => {
    fixture = await createIsolatedTestDatabase();
    const { session } = await createPlanningSession(fixture.database);
    repository = new SetupDraftRepository(fixture.database, {
      accountUserId: null,
      guestSessionId: session.id,
    });
  }, 120000);
  afterEach(async () => {
    await fixture?.cleanup();
  });
  it("replays allocation and commits one revision while rejecting stale tabs", async () => {
    const requestId = randomUUID();
    const first = await repository.allocate(requestId),
      replay = await repository.allocate(requestId);
    expect(replay.draft.draftId).toBe(first.draft.draftId);
    const input = {
      requestId: randomUUID(),
      expectedRevision: 1,
      currentStep: "origin" as const,
      payload: { ...first.draft.payload, title: "Saved title" },
    };
    const saved = await repository.save(first.draft.draftId, input);
    expect(saved.revision).toBe(2);
    expect(await repository.save(first.draft.draftId, input)).toEqual(saved);
    await expect(
      repository.save(first.draft.draftId, { ...input, requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "draft_revision_conflict" });
    expect((await repository.read(first.draft.draftId)).payload.title).toBe("Saved title");
  });
  it("denies unrelated authority and rolls back invalid submission", async () => {
    const { draft } = await repository.allocate(randomUUID());
    const unrelated = await createPlanningSession(fixture.database);
    await expect(
      new SetupDraftRepository(fixture.database, {
        accountUserId: null,
        guestSessionId: unrelated.session.id,
      }).read(draft.draftId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(repository.submit(draft.draftId, { expectedRevision: 1 })).rejects.toThrow();
    expect(await fixture.database.selectFrom("trips").selectAll().execute()).toHaveLength(0);
  });
  it("submits exactly one trip across concurrent/lost-response retries and seals setup edits", async () => {
    const { draft } = await repository.allocate(randomUUID());
    const saved = await repository.save(draft.draftId, {
      requestId: randomUUID(),
      expectedRevision: 1,
      currentStep: "review",
      payload: validSetupPayload(),
    });
    const first = await repository.submit(draft.draftId, { expectedRevision: saved.revision });
    const repeats = await Promise.all([
      repository.submit(draft.draftId, { expectedRevision: saved.revision }),
      repository.submit(draft.draftId, { expectedRevision: saved.revision }),
    ]);
    for (const replay of repeats) expect(replay.tripId).toBe(first.tripId);
    expect(repeats[0].researchRequestId).toBe(first.researchRequestId);
    expect(await fixture.database.selectFrom("trips").selectAll().execute()).toHaveLength(1);
    expect(await fixture.database.selectFrom("tripVersions").selectAll().execute()).toHaveLength(1);
    await expect(
      repository.save(draft.draftId, {
        requestId: randomUUID(),
        expectedRevision: saved.revision,
        currentStep: "review",
        payload: validSetupPayload(),
      }),
    ).rejects.toMatchObject({ code: "draft_already_submitted" });
  });
});
