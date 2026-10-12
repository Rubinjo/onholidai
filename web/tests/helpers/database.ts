import { randomUUID } from "node:crypto";

import {
  CamelCasePlugin,
  Kysely,
  PostgresDialect,
} from "kysely";
import { Pool } from "pg";

import type { Database } from "../../server/db/database";
import { migrate } from "../../server/db/migrate";

export interface IsolatedTestDatabase {
  readonly databaseName: string;
  readonly connectionString: string;
  readonly database: Kysely<Database>;
  cleanup(): Promise<void>;
}

export interface IsolatedTestDatabaseOptions {
  readonly adminConnectionString?: string;
  readonly migrationConnectionString?: string;
  readonly applicationConnectionString?: string;
}

export function hasIsolatedDatabaseConfiguration(): boolean {
  return Boolean(
    process.env.TEST_DATABASE_ADMIN_URL &&
      (process.env.TEST_DATABASE_MIGRATION_URL ?? process.env.MIGRATION_DATABASE_URL),
  );
}

function connectionStringForDatabase(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  url.search = "";
  return url.toString();
}

export async function createIsolatedTestDatabase({
  adminConnectionString = process.env.TEST_DATABASE_ADMIN_URL,
  migrationConnectionString =
    process.env.TEST_DATABASE_MIGRATION_URL ?? process.env.MIGRATION_DATABASE_URL,
  applicationConnectionString =
    process.env.TEST_DATABASE_APP_URL ?? process.env.DATABASE_URL,
}: IsolatedTestDatabaseOptions = {}): Promise<IsolatedTestDatabase> {
  if (!adminConnectionString || !migrationConnectionString) {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL and TEST_DATABASE_MIGRATION_URL are required for isolated tests",
    );
  }

  const databaseName = `onholidai_test_${randomUUID().replaceAll("-", "")}`;
  const migrationUrl = connectionStringForDatabase(
    migrationConnectionString,
    databaseName,
  );
  const connectionString = connectionStringForDatabase(
    applicationConnectionString ?? migrationConnectionString,
    databaseName,
  );
  const adminPool = new Pool({
    application_name: "onholidai-test-database-admin",
    connectionString: adminConnectionString,
    max: 1,
  });
  let databaseCreated = false;

  try {
    await adminPool.query(
      `CREATE DATABASE "${databaseName}" OWNER onholidai_migration TEMPLATE template0`,
    );
    databaseCreated = true;
    await adminPool.query(`REVOKE CONNECT ON DATABASE "${databaseName}" FROM PUBLIC`);
    await adminPool.query(
      `GRANT CONNECT ON DATABASE "${databaseName}" TO onholidai_migration, onholidai_web, onholidai_worker`,
    );
    await migrate(migrationUrl);
  } catch (error) {
    if (databaseCreated) {
      await adminPool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    }
    await adminPool.end();
    throw error;
  }

  const database = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        application_name: "onholidai-isolated-test",
        connectionString,
        max: 4,
      }),
    }),
    plugins: [new CamelCasePlugin()],
  }).withSchema("app");
  let cleanedUp = false;

  return {
    databaseName,
    connectionString,
    database,
    async cleanup() {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      await database.destroy();
      await adminPool.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await adminPool.end();
    },
  };
}

export async function withIsolatedTestDatabase<T>(
  test: (fixture: IsolatedTestDatabase) => Promise<T>,
): Promise<T> {
  const fixture = await createIsolatedTestDatabase();
  try {
    return await test(fixture);
  } finally {
    await fixture.cleanup();
  }
}