// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadMigrationFiles, migrate } from "../../server/db/migrate";
import { decodeTripSnapshot } from "../../domain/trip/schema";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { createIsolatedTestDatabase, hasIsolatedDatabaseConfiguration,
  type IsolatedTestDatabase } from "../helpers/database";

describe("migration discovery", () => {
  it("rejects a gap before connecting", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-migrations-"));
    try {
      await writeFile(join(directory, "002_gap.sql"), "SELECT 1;\n");
      await expect(loadMigrationFiles(directory)).rejects.toThrow("Expected migration version 1");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("keeps legacy snapshots readable while requiring explicit origin before new flight estimates", () => {
    const legacy = createSyntheticTripSnapshot();
    delete (legacy as Partial<typeof legacy>).departureOrigin;
    const decoded = decodeTripSnapshot(0, legacy);
    expect(decoded.compatibility).toBe("legacy");
    expect(decoded.requiresDepartureOrigin).toBe(true);
    expect(decoded.snapshot.destinations[0]?.name).toBe("Lisbon");
  });

  it("retains proposal and transaction basis migrations as additive schema history", async () => {
    const migrations = await loadMigrationFiles();
    expect(migrations.map((entry) => entry.version)).toEqual(migrations.map((_entry, index) => index + 1));
    expect(migrations.find((entry) => entry.version === 7)?.sql).toContain("change_proposals");
    expect(migrations.find((entry) => entry.version === 8)?.sql).toContain("execution_basis jsonb NOT NULL");
    expect(migrations.find((entry) => entry.version === 8)?.sql).toContain("booking_provider_callbacks");
    expect(migrations.find((entry) => entry.version === 9)?.sql).toContain("privacy_legal_holds");
  });
});

if (process.env.CI && !hasIsolatedDatabaseConfiguration()) {
  throw new Error("CI must provision isolated PostgreSQL test credentials");
}

describe.skipIf(!hasIsolatedDatabaseConfiguration())("PostgreSQL migration compatibility", () => {
  let fixture: IsolatedTestDatabase;
  let tripId: string;

  beforeEach(async () => {
    fixture = await createIsolatedTestDatabase();
    tripId = randomUUID();
    await query(fixture.connectionString, async (client) => {
      await client.query(`INSERT INTO app."user" (id, name, email)
        VALUES ('synthetic-owner', 'Synthetic owner', 'owner@example.invalid')`);
      await client.query(`INSERT INTO app.trips (id, owner_user_id, title, currency)
        VALUES ($1, 'synthetic-owner', 'Synthetic trip', 'GBP')`, [tripId]);
    });
  }, 30_000);

  afterEach(async () => { await fixture?.cleanup(); });

  async function query<T>(url: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    const pool = new Pool({ connectionString: url, max: 1 });
    try {
      const client = await pool.connect();
      try { return await action(client); } finally { client.release(); }
    } finally { await pool.end(); }
  }

  async function insertVersion(inverse: unknown, reason: string | null, version = 1) {
    return query(fixture.connectionString, (client) => client.query(`INSERT INTO app.trip_versions
      (trip_id, version, previous_version, schema_version, snapshot, initiating_actor,
       initiating_request_id, change_summary, inverse_operation, non_reversible_reason)
      VALUES ($1, $2, $3, 1, '{}', 'user', $4, '["created"]', $5::jsonb, $6)`,
    [tripId, version, version === 1 ? null : version - 1, randomUUID(),
      inverse === null ? null : JSON.stringify(inverse), reason]));
  }

  it("reruns safely and rejects changed applied migration checksums", async () => {
    await expect(migrate(fixture.migrationConnectionString)).resolves.toEqual([]);
    const directory = await mkdtemp(join(tmpdir(), "onholidai-migrations-"));
    try {
      const migrations = await loadMigrationFiles();
      for (const migration of migrations) {
        await writeFile(join(directory, migration.filename),
          migration.sql + (migration.version === 1 ? "\n-- changed applied history\n" : ""));
      }
      await expect(migrate(fixture.migrationConnectionString, directory)).rejects.toThrow("does not match");
      await expect(migrate(fixture.migrationConnectionString)).resolves.toEqual([]);
    } finally { await rm(directory, { force: true, recursive: true }); }
  });

  it("upgrades valid historical evidence without rewriting snapshots", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-prior-migrations-"));
    let prior: IsolatedTestDatabase | undefined;
    try {
      const migrations = await loadMigrationFiles();
      for (const migration of migrations.filter((item) => item.version < 3)) {
        await writeFile(join(directory, migration.filename), migration.sql);
      }
      prior = await createIsolatedTestDatabase({ migrationsDirectory: directory });
      await query(prior.connectionString, async (client) => {
        await client.query(`INSERT INTO app."user" (id, name, email)
          VALUES ('synthetic-owner', 'Synthetic owner', 'owner@example.invalid')`);
        await client.query(`INSERT INTO app.trips (id, owner_user_id, title, currency)
          VALUES ($1, 'synthetic-owner', 'Historical synthetic trip', 'GBP')`, [tripId]);
        await client.query(`INSERT INTO app.trip_versions
          (trip_id, version, schema_version, snapshot, initiating_actor,
           initiating_request_id, change_summary, non_reversible_reason)
          VALUES ($1, 1, 1, '{"historical":true}', 'user', $2, '["created"]', 'Initial creation')`,
        [tripId, randomUUID()]);
      });
      const before = await prior.database.selectFrom("tripVersions").selectAll().execute();
      const pending = (await loadMigrationFiles()).filter((item) => item.version >= 3).map((item) => item.filename);
      await expect(migrate(prior.migrationConnectionString)).resolves.toEqual(pending);
      expect(await prior.database.selectFrom("tripVersions").selectAll().execute()).toEqual(before);
    } finally {
      await prior?.cleanup();
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  it("fails the corrective migration atomically for missing historical evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-prior-migrations-"));
    let prior: IsolatedTestDatabase | undefined;
    try {
      for (const migration of (await loadMigrationFiles()).filter((item) => item.version < 3)) {
        await writeFile(join(directory, migration.filename), migration.sql);
      }
      prior = await createIsolatedTestDatabase({ migrationsDirectory: directory });
      await query(prior.connectionString, async (client) => {
        await client.query(`INSERT INTO app."user" (id, name, email)
          VALUES ('synthetic-owner', 'Synthetic owner', 'owner@example.invalid')`);
        await client.query(`INSERT INTO app.trips (id, owner_user_id, title, currency)
          VALUES ($1, 'synthetic-owner', 'Historical synthetic trip', 'GBP')`, [tripId]);
        // Migration 002 permits this through SQL's three-valued CHECK logic.
        await client.query(`INSERT INTO app.trip_versions
          (trip_id, version, schema_version, snapshot, initiating_actor,
           initiating_request_id, change_summary)
          VALUES ($1, 1, 1, '{}', 'user', $2, '["created"]')`, [tripId, randomUUID()]);
      });
      const before = await prior.database.selectFrom("tripVersions").selectAll().execute();
      await expect(migrate(prior.migrationConnectionString)).rejects.toMatchObject({ code: "23514" });
      expect(await prior.database.selectFrom("tripVersions").selectAll().execute()).toEqual(before);
      await query(prior.migrationConnectionString, async (client) => {
        const history = await client.query<{ version: number }>(
          "SELECT version FROM onholidai_migrations.applied_migrations ORDER BY version");
        expect(history.rows).toEqual([{ version: 1 }, { version: 2 }]);
      });
    } finally {
      await prior?.cleanup();
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);

  it("round-trips SRID 4326 spatial data and rejects incorrect SRIDs", async () => {
    await query(fixture.connectionString, async (client) => {
      await client.query(`INSERT INTO app.spatial_places (entity_type, entity_id, location)
        VALUES ('synthetic', $1, ST_GeogFromText('SRID=4326;POINT(-9.1393 38.7223)'))`, [tripId]);
      const place = await client.query<{ srid: number }>(
        "SELECT ST_SRID(location::geometry) AS srid FROM app.spatial_places");
      expect(place.rows).toEqual([{ srid: 4326 }]);
      await expect(client.query(`INSERT INTO app.spatial_places (entity_type, entity_id, location)
        VALUES ('wrong-srid', $1, ST_SetSRID(ST_Point(0, 0), 3857)::geography)`, [tripId])).rejects.toThrow();
      const indexes = await client.query<{ count: string }>(`SELECT count(*) FROM pg_indexes
        WHERE schemaname = 'app' AND tablename IN ('spatial_places', 'spatial_routes')
        AND indexdef ILIKE '%USING gist%'`);
      expect(indexes.rows[0]?.count).toBe("2");
    });
  });

  it.each([
    [null, null], [null, ""], [null, " \t\n"],
    [{ operation: "replace", target: "/preferences/pace", value: 50 }, "Both present"],
    [[], null], [{}, null], [{ operation: "book", target: "/components", value: null }, null],
    [{ operation: "replace", target: "/forbidden", value: null }, null],
    [{ operation: "replace", target: null, value: null }, null],
    [{ operation: "replace", target: "/preferences", value: null, extra: true }, null],
  ])("rejects invalid reversibility evidence %#", async (inverse, reason) => {
    await expect(insertVersion(inverse, reason as string | null)).rejects.toMatchObject({
      code: "23514", constraint: "trip_versions_reversibility_evidence",
    });
    const count = await fixture.database.selectFrom("tripVersions")
      .select((builder) => builder.fn.countAll().as("count")).executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(0);
  });

  it("accepts either a valid inverse or a disclosed reason", async () => {
    await insertVersion(null, "Initial creation");
    await insertVersion({ operation: "replace", target: "/preferences/pace", value: 50 }, null, 2);
    expect(await fixture.database.selectFrom("tripVersions").select("version").orderBy("version").execute())
      .toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("enforces lifecycle and immutable idempotency identity at the SQL boundary", async () => {
    await query(fixture.connectionString, async (client) => {
      await expect(client.query("UPDATE app.trips SET lifecycle_state = 'invented' WHERE id = $1", [tripId]))
        .rejects.toMatchObject({ code: "23514" });
      await expect(client.query(`INSERT INTO app.idempotency_records
        (scope, idempotency_key, request_fingerprint, state, expires_at)
        VALUES ('synthetic', 'invalid', $1, 'invented', now() + interval '1 day')`, ["a".repeat(64)]))
        .rejects.toMatchObject({ code: "23514" });
      await client.query(`INSERT INTO app.idempotency_records
        (scope, idempotency_key, request_fingerprint, state, expires_at)
        VALUES ('synthetic', 'valid', $1, 'in_progress', now() + interval '1 day')`, ["a".repeat(64)]);
      await expect(client.query(`UPDATE app.idempotency_records SET request_fingerprint = $1
        WHERE scope = 'synthetic'`, ["b".repeat(64)])).rejects.toMatchObject({ code: "23505" });
      await expect(client.query(`UPDATE app.idempotency_records SET state = 'completed'
        WHERE scope = 'synthetic'`)).rejects.toMatchObject({ code: "23514" });
      const identity = await client.query<{ state: string; request_fingerprint: string }>(
        "SELECT state, request_fingerprint FROM app.idempotency_records WHERE scope = 'synthetic'");
      expect(identity.rows).toEqual([{ state: "in_progress", request_fingerprint: "a".repeat(64) }]);
    });
  });

  it("protects immutable history and audit even from the migration owner", async () => {
    await insertVersion(null, "Initial creation");
    await query(fixture.connectionString, (client) => client.query(`INSERT INTO app.audit_events
      (id, actor_type, actor_id, action, target_type, target_id, request_id, outcome)
      VALUES ($1, 'user', 'synthetic-owner', 'synthetic.test', 'trip', $2, $3, 'succeeded')`,
    [randomUUID(), tripId, randomUUID()]));
    for (const table of ["trip_versions", "audit_events"]) {
      const assignment = table === "trip_versions" ? "schema_version = 2" : "outcome = 'failed'";
      for (const statement of [`UPDATE app.${table} SET ${assignment}`, `DELETE FROM app.${table}`]) {
        await expect(query(fixture.migrationConnectionString, (client) => client.query(statement)))
          .rejects.toMatchObject({ code: "55000" });
      }
    }
  });

  it("isolates nonprivileged web/worker roles from migrations and public access", async () => {
    for (const url of [fixture.connectionString, fixture.workerConnectionString]) {
      await query(url, async (client) => {
        const role = await client.query<{ rolsuper: boolean; rolcreatedb: boolean }>(
          "SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user");
        expect(role.rows[0]).toEqual({ rolsuper: false, rolcreatedb: false });
        await client.query("SELECT * FROM app.trips");
        await expect(client.query("CREATE TABLE app.forbidden (id integer)"))
          .rejects.toMatchObject({ code: "42501" });
        await expect(client.query("SELECT * FROM onholidai_migrations.applied_migrations"))
          .rejects.toMatchObject({ code: "42501" });
        await expect(client.query("DELETE FROM app.trip_versions"))
          .rejects.toMatchObject({ code: "42501" });
      });
      await expect(migrate(url)).rejects.toThrow("Migrations must run as onholidai_migration");
    }
    await query(fixture.adminConnectionString, async (client) => {
      await client.query("BEGIN");
      try {
        await client.query("SET LOCAL ROLE onholidai_test_untrusted");
        await expect(client.query("SELECT * FROM app.trips")).rejects.toMatchObject({ code: "42501" });
      } finally { await client.query("ROLLBACK"); }
    });
  });
});
