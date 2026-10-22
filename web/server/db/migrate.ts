import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import { Pool, type PoolClient } from "pg";

const migrationFilePattern = /^(?<version>\d{3,})_(?<name>[a-z][a-z0-9_]*)\.sql$/;
const migrationLockId = "761742826539061";
const expectedMigrationRole = "onholidai_migration";

export const defaultMigrationsDirectory = resolve(process.cwd(), "server/db/migrations");

export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  checksum: string;
  sql: string;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
  checksum: string;
}

export async function loadMigrationFiles(
  directory = defaultMigrationsDirectory,
): Promise<MigrationFile[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sqlFilenames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();

  if (sqlFilenames.length === 0) {
    throw new Error(`No SQL migrations found in ${directory}`);
  }

  const migrations = await Promise.all(
    sqlFilenames.map(async (filename): Promise<MigrationFile> => {
      const match = migrationFilePattern.exec(filename);
      if (!match?.groups) {
        throw new Error(`Migration ${filename} must match NNN_lowercase_name.sql`);
      }

      const sql = await readFile(resolve(directory, filename), "utf8");

      return {
        version: Number.parseInt(match.groups.version, 10),
        name: match.groups.name,
        filename,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      };
    }),
  );

  migrations.sort((left, right) => left.version - right.version);
  migrations.forEach((migration, index) => {
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(`Expected migration version ${expectedVersion}, found ${migration.filename}`);
    }
  });

  return migrations;
}

async function prepareMigrationHistory(client: PoolClient): Promise<void> {
  const roleResult = await client.query<{ current_user: string }>("SELECT current_user");
  if (roleResult.rows[0]?.current_user !== expectedMigrationRole) {
    throw new Error(
      `Migrations must run as ${expectedMigrationRole}; connected as ${roleResult.rows[0]?.current_user ?? "unknown"}`,
    );
  }

  await client.query(`
    CREATE SCHEMA IF NOT EXISTS onholidai_migrations AUTHORIZATION CURRENT_USER;
    REVOKE ALL ON SCHEMA onholidai_migrations FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS onholidai_migrations.applied_migrations (
      version integer PRIMARY KEY CHECK (version > 0),
      name text NOT NULL UNIQUE,
      checksum character(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    REVOKE ALL ON onholidai_migrations.applied_migrations FROM PUBLIC;
  `);
}

function pendingMigrations(
  migrations: MigrationFile[],
  applied: AppliedMigrationRow[],
): MigrationFile[] {
  applied.forEach((record, index) => {
    const migration = migrations[index];
    if (!migration) {
      throw new Error(`Applied migration ${record.version}_${record.name} is missing from disk`);
    }
    if (
      migration.version !== record.version ||
      migration.name !== record.name ||
      migration.checksum !== record.checksum
    ) {
      throw new Error(
        `Applied migration ${record.version}_${record.name} does not match ${migration.filename}`,
      );
    }
  });

  return migrations.slice(applied.length);
}

async function applyMigration(client: PoolClient, migration: MigrationFile): Promise<void> {
  await client.query("BEGIN");
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO onholidai_migrations.applied_migrations
        (version, name, checksum)
       VALUES ($1, $2, $3)`,
      [migration.version, migration.name, migration.checksum],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

export async function migrate(
  connectionString: string,
  directory = defaultMigrationsDirectory,
): Promise<string[]> {
  const migrations = await loadMigrationFiles(directory);
  const pool = new Pool({
    application_name: "onholidai-migrations",
    connectionString,
    max: 1,
  });
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [migrationLockId]);
    await prepareMigrationHistory(client);
    const result = await client.query<AppliedMigrationRow>(
      `SELECT version, name, checksum
       FROM onholidai_migrations.applied_migrations
       ORDER BY version`,
    );
    const pending = pendingMigrations(migrations, result.rows);

    for (const migration of pending) {
      await applyMigration(client, migration);
    }

    return pending.map((migration) => migration.filename);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]);
    client.release();
    await pool.end();
  }
}

function isEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  return Boolean(entrypoint && pathToFileURL(resolve(entrypoint)).href === import.meta.url);
}

if (isEntrypoint()) {
  const connectionString = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required");
  }

  migrate(connectionString)
    .then((applied) => {
      process.stdout.write(
        applied.length > 0
          ? `Applied migrations: ${applied.join(", ")}\n`
          : "Database is up to date\n",
      );
    })
    .catch((error: unknown) => {
      process.stderr.write(
        `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
