// @vitest-environment node
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commitTripMutation, type CommitTripMutationInput } from "../../domain/trip/commit";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import {
  createIsolatedTestDatabase,
  hasIsolatedDatabaseConfiguration,
  type IsolatedTestDatabase,
} from "../helpers/database";

vi.mock("server-only", () => ({}));

if (process.env.CI && !hasIsolatedDatabaseConfiguration()) {
  throw new Error("CI must provision isolated PostgreSQL test credentials");
}

describe.skipIf(!hasIsolatedDatabaseConfiguration())("PostgreSQL trip commits", () => {
  let fixture: IsolatedTestDatabase;
  let tripId: string;

  beforeEach(async () => {
    fixture = await createIsolatedTestDatabase();
    tripId = randomUUID();
    await sql`INSERT INTO app."user" (id, name, email)
      VALUES ('synthetic-owner', 'Synthetic owner', 'owner@example.invalid')`.execute(fixture.database);
    await fixture.database.insertInto("trips").values({
      id: tripId, ownerUserId: "synthetic-owner", title: "Synthetic trip",
      lifecycleState: "draft", currentVersion: 1, currency: "GBP",
    }).execute();
    await sql`INSERT INTO app.trip_versions
      (trip_id, version, previous_version, schema_version, snapshot, initiating_actor,
       initiating_request_id, change_summary, inverse_operation, non_reversible_reason)
      VALUES (${tripId}::uuid, 1, NULL, 1, ${JSON.stringify(createSyntheticTripSnapshot())}::jsonb,
        'user', ${randomUUID()}::uuid, '["created"]', NULL, 'Initial trip creation')`.execute(fixture.database);
  }, 30_000);

  afterEach(async () => { await fixture?.cleanup(); });

  function command(overrides: Partial<CommitTripMutationInput> = {}): CommitTripMutationInput {
    return {
      tripId, ownerUserId: "synthetic-owner", expectedVersion: 1,
      requestId: randomUUID(), idempotencyKey: randomUUID(), requestFingerprint: "a".repeat(64),
      snapshot: createSyntheticTripSnapshot(), initiatingActor: "user", proposalId: null,
      changeSummary: ["preferences"],
      inverseOperation: { operation: "replace", target: "/preferences/pace", value: 50 },
      nonReversibleReason: null, outboxEventId: randomUUID(), auditEventId: randomUUID(),
      traceId: null, ...overrides,
    };
  }

  async function state() {
    const db = fixture.database;
    return {
      trip: await db.selectFrom("trips").selectAll().executeTakeFirstOrThrow(),
      versions: await db.selectFrom("tripVersions").selectAll().orderBy("version").execute(),
      events: await db.selectFrom("outboxEvents").selectAll().execute(),
      audit: await db.selectFrom("auditEvents").selectAll().execute(),
      receipts: await db.selectFrom("idempotencyRecords").selectAll().execute(),
    };
  }

  it("persists a complete snapshot, event, audit and receipt atomically", async () => {
    const input = command();
    input.snapshot.preferences.pace = 60;
    const result = await commitTripMutation(fixture.database, input);
    const saved = await state();
    expect(saved.trip.currentVersion).toBe(2);
    expect(saved.versions.map((version) => version.version)).toEqual([1, 2]);
    expect(saved.versions[1]?.snapshot).toEqual(input.snapshot);
    expect(saved.events).toHaveLength(1);
    expect(saved.events[0]?.payload).not.toHaveProperty("snapshot");
    expect(saved.audit).toHaveLength(1);
    expect(saved.receipts[0]?.resultReference).toEqual(result);
  });

  it("returns an authorized original receipt after later versions without new writes", async () => {
    const input = command();
    const original = await commitTripMutation(fixture.database, input);
    await commitTripMutation(fixture.database, command({ expectedVersion: 2 }));
    const before = await state();
    const retry = await commitTripMutation(fixture.database, {
      ...input, outboxEventId: randomUUID(), auditEventId: randomUUID(), traceId: "retry-trace",
    });
    expect(retry).toEqual({ ...original, replayed: true });
    expect(await state()).toEqual(before);
  });

  it("denies a different owner before disclosing a completed receipt", async () => {
    const input = command();
    await commitTripMutation(fixture.database, input);
    const before = await state();
    await expect(commitTripMutation(fixture.database, { ...input, ownerUserId: "other-owner" }))
      .rejects.toMatchObject({ code: "trip_access_denied" });
    expect(await state()).toEqual(before);
  });

  it("rejects unauthorized first writes, stale versions and invalid snapshots without mutation", async () => {
    const before = await state();
    await expect(commitTripMutation(fixture.database, command({ ownerUserId: "other-owner" })))
      .rejects.toMatchObject({ code: "trip_access_denied" });
    await expect(commitTripMutation(fixture.database, command({ tripId: randomUUID() })))
      .rejects.toMatchObject({ code: "trip_not_found" });
    await expect(commitTripMutation(fixture.database, command({ expectedVersion: 2 })))
      .rejects.toMatchObject({ code: "trip_version_conflict" });
    const invalid = command();
    invalid.snapshot.travellerParty.adults = 0;
    await expect(commitTripMutation(fixture.database, invalid)).rejects.toThrow();
    expect(await state()).toEqual(before);
  });

  it("matches equivalent JSON objects regardless of property order", async () => {
    const input = command();
    const original = await commitTripMutation(fixture.database, input);
    const retry = structuredClone(input);
    retry.snapshot.preferences = {
      setting: input.snapshot.preferences.setting, independence: input.snapshot.preferences.independence,
      discovery: input.snapshot.preferences.discovery, spend: input.snapshot.preferences.spend,
      pace: input.snapshot.preferences.pace,
    };
    await expect(commitTripMutation(fixture.database, retry))
      .resolves.toEqual({ ...original, replayed: true });
  });

  it.each(["snapshot", "requestId", "initiatingActor", "requestFingerprint"] as const)(
    "rejects changed %s even when the idempotency key is reused", async (field) => {
      const input = command();
      await commitTripMutation(fixture.database, input);
      const retry = structuredClone(input);
      if (field === "snapshot") retry.snapshot.preferences.pace = 90;
      if (field === "requestId") retry.requestId = randomUUID();
      if (field === "initiatingActor") retry.initiatingActor = "system_revalidation";
      if (field === "requestFingerprint") retry.requestFingerprint = "b".repeat(64);
      const before = await state();
      await expect(commitTripMutation(fixture.database, retry))
        .rejects.toMatchObject({ code: "idempotency_fingerprint_conflict" });
      expect(await state()).toEqual(before);
    },
  );

  it("serializes identical concurrent retries into one commit", async () => {
    const input = command();
    const results = await Promise.all([
      commitTripMutation(fixture.database, input), commitTripMutation(fixture.database, input),
    ]);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect((await state()).versions).toHaveLength(2);
  });

  it("permits exactly one of two competing commits", async () => {
    const results = await Promise.allSettled([
      commitTripMutation(fixture.database, command()),
      commitTripMutation(fixture.database, command()),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "trip_version_conflict" });
    const saved = await state();
    expect(saved.versions).toHaveLength(2);
    expect(saved.events).toHaveLength(1);
    expect(saved.audit).toHaveLength(1);
    expect(saved.receipts).toHaveLength(1);
  });

  it("rolls back snapshot, pointer, event and receipt on a late audit failure", async () => {
    const first = command();
    await commitTripMutation(fixture.database, first);
    const before = await state();
    const next = command({ expectedVersion: 2, auditEventId: first.auditEventId });
    await expect(commitTripMutation(fixture.database, next)).rejects.toMatchObject({ code: "23505" });
    expect(await state()).toEqual(before);
    await expect(commitTripMutation(fixture.database, { ...next, auditEventId: randomUUID() }))
      .resolves.toMatchObject({ version: 3, replayed: false });
  });
});
