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
  // History written before checksums were normalised hashed the checkout's raw bytes,
  // so a CRLF file recorded a different value for identical SQL.
  legacyChecksums: readonly string[];
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
      const checksum = createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex");
      const rawChecksum = createHash("sha256").update(sql).digest("hex");

      return {
        version: Number.parseInt(match.groups.version, 10),
        name: match.groups.name,
        filename,
        // Checksums must not depend on the checkout's line endings: a CRLF copy of an
        // applied migration would otherwise fail the applied-history guard.
        checksum,
        legacyChecksums: rawChecksum === checksum ? [] : [rawChecksum],
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
): { pending: MigrationFile[]; repairs: { version: number; checksum: string }[] } {
  const repairs: { version: number; checksum: string }[] = [];
  applied.forEach((record, index) => {
    const migration = migrations[index];
    if (!migration) {
      throw new Error(`Applied migration ${record.version}_${record.name} is missing from disk`);
    }
    if (migration.version !== record.version || migration.name !== record.name) {
      throw new Error(
        `Applied migration ${record.version}_${record.name} does not match ${migration.filename}`,
      );
    }
    if (record.checksum === migration.checksum) return;
    if (!migration.legacyChecksums.includes(record.checksum)) {
      throw new Error(
        `Applied migration ${record.version}_${record.name} does not match ${migration.filename}`,
      );
    }
    repairs.push({ version: migration.version, checksum: migration.checksum });
  });

  return { pending: migrations.slice(applied.length), repairs };
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

    if (pending.repairs.length) {
      await client.query("BEGIN");
      try {
        for (const repair of pending.repairs) {
          await client.query(
            `UPDATE onholidai_migrations.applied_migrations SET checksum = $2 WHERE version = $1`,
            [repair.version, repair.checksum],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }

    for (const migration of pending.pending) {
      await applyMigration(client, migration);
    }

    return pending.pending.map((migration) => migration.filename);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [migrationLockId]);
    client.release();
    await pool.end();
  }
}

export interface MigrationStatus {
  /** False when the connected role may not read the applied-migration history. */
  readable: boolean;
  applied: number;
  expected: number;
  pending: readonly string[];
  /** True only when the history is readable, matches the checkout and has nothing pending. */
  current: boolean;
  /** `behind`, `history_mismatch` or `unreadable` when the database is not current. */
  problem: "behind" | "history_mismatch" | "unreadable" | null;
}

/**
 * Reports whether the database is at the checkout's schema version. The application
 * role normally cannot read the migration history, so an unreadable history is
 * reported rather than treated as drift.
 */
export async function migrationStatus(
  connectionString: string,
  directory = defaultMigrationsDirectory,
): Promise<MigrationStatus> {
  const migrations = await loadMigrationFiles(directory);
  const pool = new Pool({
    application_name: "onholidai-migrations-check",
    connectionString,
    max: 1,
  });
  try {
    const result = await pool.query<AppliedMigrationRow>(
      `SELECT version, name, checksum
       FROM onholidai_migrations.applied_migrations
       ORDER BY version`,
    );
    let pending: MigrationFile[];
    try {
      pending = pendingMigrations(migrations, result.rows).pending;
    } catch {
      return {
        readable: true,
        applied: result.rows.length,
        expected: migrations.length,
        pending: migrations.slice(result.rows.length).map((migration) => migration.filename),
        current: false,
        problem: "history_mismatch",
      };
    }
    return {
      readable: true,
      applied: result.rows.length,
      expected: migrations.length,
      pending: pending.map((migration) => migration.filename),
      current: pending.length === 0,
      problem: pending.length === 0 ? null : "behind",
    };
  } catch (error) {
    const code = (error as { code?: string }).code ?? "";
    // A missing history table means nothing has been applied yet: that is drift, not
    // an unreadable history. Only a permission failure is reported as unknown.
    if (code === "42P01")
      return {
        readable: true,
        applied: 0,
        expected: migrations.length,
        pending: migrations.map((migration) => migration.filename),
        current: false,
        problem: "behind",
      };
    if (code === "42501")
      return {
        readable: false,
        applied: 0,
        expected: migrations.length,
        pending: [],
        current: true,
        problem: "unreadable",
      };
    throw error;
  } finally {
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

  const check = process.argv.includes("--check");
  (check
    ? migrationStatus(connectionString).then((status) => {
        process.stdout.write(`${JSON.stringify(status)}\n`);
        if (!status.current) {
          process.stderr.write(
            status.problem === "behind"
              ? `Database is behind: apply ${status.pending.join(", ")}\n`
              : "Database migration history does not match this checkout\n",
          );
          process.exitCode = 1;
        }
      })
    : migrate(connectionString).then((applied) => {
        process.stdout.write(
          applied.length > 0
            ? `Applied migrations: ${applied.join(", ")}\n`
            : "Database is up to date\n",
        );
      })
  ).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
