// @vitest-environment node
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTrip } from "../../domain/trip/create";
import { readAgentTrip, readTrip } from "../../domain/trip/read";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { readPricingDiagnostic } from "../../domain/pricing/diagnostics";
import { ProposalRepository } from "../../server/db/proposal-repository";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { createIsolatedTestDatabase, hasIsolatedDatabaseConfiguration, type IsolatedTestDatabase } from "../helpers/database";

vi.mock("server-only", () => ({}));
if (process.env.CI && !hasIsolatedDatabaseConfiguration()) throw new Error("CI must provision PostgreSQL test credentials");

describe.skipIf(!hasIsolatedDatabaseConfiguration())("initial trip persistence", () => {
  let fixture: IsolatedTestDatabase;
  const owner = "10000000-0000-4000-8000-000000000011";

  beforeEach(async () => {
    fixture = await createIsolatedTestDatabase();
    await sql`INSERT INTO app."user" (id, name, email)
      VALUES (${owner}, 'Synthetic owner', 'planning@example.invalid')`.execute(fixture.database);
  }, 30_000);
  afterEach(async () => { await fixture?.cleanup(); });

  function request() {
    const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
    snapshot.itineraryDays = [];
    return { requestId: randomUUID(), title: "Synthetic trip", currency: "GBP", snapshot };
  }

  it("creates one full version, safe event, audit and original response on simultaneous retries", async () => {
    const input = request();
    const results = await Promise.all([createTrip(fixture.database, owner, input), createTrip(fixture.database, owner, input)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0].version).toBe(1);
    expect(await fixture.database.selectFrom("trips").selectAll().execute()).toHaveLength(1);
    const versions = await fixture.database.selectFrom("tripVersions").selectAll().execute();
    expect(versions).toHaveLength(1);
    expect(versions[0].previousVersion).toBeNull();
    expect(versions[0].nonReversibleReason).toBeTruthy();
    expect(await fixture.database.selectFrom("outboxEvents").selectAll().execute()).toHaveLength(1);
    expect(await fixture.database.selectFrom("auditEvents").selectAll().execute()).toHaveLength(1);
    expect(await fixture.database.selectFrom("idempotencyRecords").selectAll().execute()).toHaveLength(1);
    expect(JSON.stringify(results[0])).not.toMatch(/supplierTotal|platformMarginTotal/);
  });

  it("rejects conflicting replay, ownership breaches and invalid snapshots without extra versions", async () => {
    const input = request();
    const created = await createTrip(fixture.database, owner, input);
    await expect(createTrip(fixture.database, owner, { ...input, title: "Different trip" }))
      .rejects.toMatchObject({ status: 409 });
    await expect(readTrip(fixture.database, "other-owner", created.tripId)).rejects.toMatchObject({ status: 404 });
    await expect(readAgentTrip(fixture.database, owner, created.tripId, 2, "compact"))
      .rejects.toMatchObject({ status: 409 });
    await expect(createTrip(fixture.database, owner, { ...request(), snapshot: {
      ...input.snapshot, duration: { minimumDays: 3, idealDays: 4, maximumDays: 50 },
    } })).rejects.toThrow();
    expect(await fixture.database.selectFrom("tripVersions").selectAll().execute()).toHaveLength(1);
  });

  it("requires a database-held diagnostic role and still enforces trip ownership", async () => {
    const created = await createTrip(fixture.database, owner, request());
    await expect(readPricingDiagnostic(fixture.database, owner, created.tripId, 1))
      .rejects.toMatchObject({ status: 403 });
    await sql`UPDATE app."user" SET internal_team_role = 'pricing_auditor' WHERE id = ${owner}`.execute(fixture.database);
    expect((await readPricingDiagnostic(fixture.database, owner, created.tripId, 1)).totals)
      .toEqual({ supplierMinor: 0, marginMinor: 0, taxesMinor: 0, feesMinor: 0, finalCustomerMinor: 0 });
    await sql`INSERT INTO app."user" (id, name, email, internal_team_role)
      VALUES ('other-auditor', 'Synthetic auditor', 'auditor@example.invalid', 'administrator')`.execute(fixture.database);
    await expect(readPricingDiagnostic(fixture.database, "other-auditor", created.tripId, 1))
      .rejects.toMatchObject({ status: 404 });
  });

  it("rolls back creation and its receipt if a later transactional write fails", async () => {
    const migrationPool = new Pool({ connectionString: fixture.migrationConnectionString });
    try { await migrationPool.query("REVOKE INSERT ON app.audit_events FROM onholidai_web"); }
    finally { await migrationPool.end(); }
    await expect(createTrip(fixture.database, owner, request())).rejects.toThrow();
    for (const table of ["trips", "tripVersions", "outboxEvents", "idempotencyRecords"] as const) {
      expect(await fixture.database.selectFrom(table).selectAll().execute()).toEqual([]);
    }
  });

  it("persists only proposals for the reserved run identity and never mutates a trip", async () => {
    const created = await createTrip(fixture.database, owner, request());
    const now = new Date();
    const requestId = randomUUID();
    const runId = randomUUID();
    const conversationId = randomUUID();
    await fixture.database.insertInto("conversations").values({ id: conversationId, tripId: created.tripId,
      ownerUserId: owner, retentionExpiresAt: new Date(now.getTime() + 90 * 86_400_000) }).execute();
    await fixture.database.insertInto("agentRuns").values({ id: runId, tripId: created.tripId,
      conversationId, ownerUserId: owner, requestId, baseTripVersion: 1, purpose: "refinement",
      requestFingerprint: "a".repeat(64), leaseExpiresAt: new Date(now.getTime() + 90_000),
      completedAt: null, errorCategory: null, result: null }).execute();
    const proposal = { id: randomUUID(), tripId: created.tripId, agentRunId: runId,
      initiatingRequestId: requestId, purpose: "refinement", baseTripVersion: 1,
      operations: [{ operation: "replace", target: "/preferences/pace", value: 60 }],
      affectedFacts: ["pace"], rationale: "Synthetic rationale", status: "proposed",
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 600_000).toISOString() };
    const context = { userId: owner, tripId: created.tripId, requestId, baseTripVersion: 1 };
    const repository = new ProposalRepository(fixture.database);
    expect(await repository.record(context, proposal)).toEqual(proposal);
    expect(await repository.record(context, proposal)).toEqual(proposal);
    await expect(repository.record(context, { ...proposal, rationale: "Conflicting rationale" }))
      .rejects.toMatchObject({ status: 409 });
    await expect(repository.record(context, { ...proposal, id: randomUUID(), agentRunId: randomUUID() }))
      .rejects.toMatchObject({ status: 409 });
    await expect(repository.read("other-owner", created.tripId, proposal.id)).rejects.toMatchObject({ status: 404 });
    expect(await readTrip(fixture.database, owner, created.tripId)).toEqual(created);
    expect(await fixture.database.selectFrom("changeProposals").selectAll().execute()).toHaveLength(1);
  });
});
