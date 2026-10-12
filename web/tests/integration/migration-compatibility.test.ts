import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultMigrationsDirectory,
  loadMigrationFiles,
} from "../../server/db/migrate";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("numbered SQL migrations", () => {
  it("loads a contiguous, checksummed migration history", async () => {
    const migrations = await loadMigrationFiles();

    expect(migrations.map(({ version, filename }) => ({ version, filename }))).toEqual([
      { version: 1, filename: "001_foundation.sql" },
      { version: 2, filename: "002_trip_core.sql" },
    ]);
    expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects gaps before connecting to PostgreSQL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "onholidai-migrations-"));
    temporaryDirectories.push(directory);
    await writeFile(join(directory, "002_skipped_foundation.sql"), "SELECT 1;\n");

    await expect(loadMigrationFiles(directory)).rejects.toThrow(
      "Expected migration version 1",
    );
  });
});

describe("001 foundation SQL", () => {
  it("enables PostGIS and stores indexed SRID 4326 point and route geographies", async () => {
    const [foundation] = await loadMigrationFiles(defaultMigrationsDirectory);
    expect(foundation).toBeDefined();
    const sql = foundation!.sql;

    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS postgis;/i);
    expect(sql).toMatch(/location geography\(Point, 4326\) NOT NULL/i);
    expect(sql).toMatch(/route geography\(LineString, 4326\) NOT NULL/i);
    expect(sql.match(/USING GIST/gi)).toHaveLength(2);
  });

  it("limits app schema access to migration, web, and worker roles", async () => {
    const [foundation] = await loadMigrationFiles(defaultMigrationsDirectory);
    const sql = foundation!.sql;

    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION onholidai_migration/i);
    expect(sql).toMatch(/REVOKE ALL ON SCHEMA app FROM PUBLIC/i);
    expect(sql).toMatch(/GRANT USAGE ON SCHEMA app TO onholidai_web, onholidai_worker/i);
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE onholidai_migration IN SCHEMA app/gi,
    );
    expect(
      sql.match(
        /GRANT USAGE, SELECT ON SEQUENCES TO onholidai_web, onholidai_worker;/gi,
      ),
    ).toHaveLength(1);
    expect(sql).not.toMatch(/GRANT[^;]+\b(?:PUBLIC|agent)\b/is);
  });

  it("creates the durable Better Auth session model and user profile fields", async () => {
    const [foundation] = await loadMigrationFiles(defaultMigrationsDirectory);
    const sql = foundation!.sql;

    expect(sql).toMatch(/CREATE TABLE app\."user"/i);
    expect(sql).toMatch(/locale text NOT NULL DEFAULT 'en-GB'/i);
    expect(sql).toMatch(/default_currency text NOT NULL DEFAULT 'GBP'/i);
    expect(sql).toMatch(/internal_team_role IN \('support', 'operations', 'admin'\)/i);
    expect(sql).toMatch(/CREATE TABLE app\.session/i);
    expect(sql).toMatch(/token text NOT NULL UNIQUE/i);
    expect(sql).toMatch(/CREATE TABLE app\.account/i);
    expect(sql).toMatch(/UNIQUE \(provider_id, account_id\)/i);
    expect(sql).toMatch(/CREATE TABLE app\.verification/i);
    expect(sql.match(/REFERENCES app\."user" \(id\) ON DELETE CASCADE/gi)).toHaveLength(2);
  });

  it("does not implement tables reserved for T014", async () => {
    const [foundation] = await loadMigrationFiles(defaultMigrationsDirectory);

    expect(foundation!.sql).not.toMatch(
      /CREATE TABLE\s+(?:app\.)?(?:trips|trip_versions|outbox|idempotency|audit|conversations)\b/i,
    );
  });
});

describe("database role isolation", () => {
  it("provisions only the controlled application principals", async () => {
    const initScript = await readFile(
      join(
        process.cwd(),
        "../infra/postgres/init/10-create-local-databases.sh",
      ),
      "utf8",
    );

    expect(initScript).toMatch(/CREATE ROLE onholidai_web LOGIN/);
    expect(initScript).toMatch(/CREATE ROLE onholidai_migration LOGIN/);
    expect(initScript).toMatch(/CREATE ROLE onholidai_worker LOGIN/);
    expect(initScript).toMatch(/CREATE DATABASE onholidai OWNER onholidai_migration/);
    expect(initScript).toMatch(/REVOKE CONNECT ON DATABASE onholidai FROM PUBLIC/);
    expect(initScript).toMatch(
      /GRANT CONNECT ON DATABASE onholidai TO onholidai_migration, onholidai_web, onholidai_worker/,
    );
  });

  it("uses a distinct role for each database-enabled service", async () => {
    const compose = await readFile(
      join(process.cwd(), "../infra/compose/compose.yml"),
      "utf8",
    );

    expect(compose).toContain("postgresql://onholidai_web:");
    expect(compose).toContain("postgresql://onholidai_migration:");
    expect(compose).toContain("postgresql://onholidai_worker:");
    expect(compose).not.toContain("postgresql://onholidai:");
  });
});

describe("002 trip core SQL", () => {
  it("creates versioned trip, conversation, delivery, idempotency, and audit storage", async () => {
    const migrations = await loadMigrationFiles(defaultMigrationsDirectory);
    const sql = migrations[1]!.sql;

    for (const table of [
      "trips",
      "trip_versions",
      "conversations",
      "conversation_messages",
      "conversation_summaries",
      "outbox_events",
      "idempotency_records",
      "audit_events",
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE app\\.${table}\\b`, "i"));
    }
  });

  it("makes historical versions and audit evidence append-only", async () => {
    const migrations = await loadMigrationFiles(defaultMigrationsDirectory);
    const sql = migrations[1]!.sql;

    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON app\.trip_versions/i);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON app\.audit_events/i);
    expect(sql).toMatch(/REVOKE UPDATE, DELETE ON app\.trip_versions, app\.audit_events/i);
  });

  it("supports leased outbox delivery with retry metadata", async () => {
    const migrations = await loadMigrationFiles(defaultMigrationsDirectory);
    const sql = migrations[1]!.sql;

    expect(sql).toMatch(/delivery_state IN \('pending', 'delivering', 'delivered', 'failed'\)/i);
    expect(sql).toMatch(/attempts integer NOT NULL DEFAULT 0/i);
    expect(sql).toMatch(/next_attempt_at timestamptz NOT NULL DEFAULT now\(\)/i);
    expect(sql).toMatch(/lease_expires_at timestamptz/i);
    expect(sql).toMatch(/WHERE delivery_state IN \('pending', 'failed'\)/i);
  });

  it("guards idempotency states and immutable request fingerprints", async () => {
    const migrations = await loadMigrationFiles(defaultMigrationsDirectory);
    const sql = migrations[1]!.sql;

    expect(sql).toMatch(/state IN \('in_progress', 'completed', 'unknown'\)/i);
    expect(sql).toMatch(/PRIMARY KEY \(scope, idempotency_key\)/i);
    expect(sql).toMatch(/NEW\.request_fingerprint <> OLD\.request_fingerprint/i);
    expect(sql).toMatch(/ERRCODE = '23505'/i);
  });
});