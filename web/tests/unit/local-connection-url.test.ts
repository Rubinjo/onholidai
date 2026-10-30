// @vitest-environment node
import { describe, expect, it } from "vitest";

import { resolveMigrationConnectionString } from "../../server/db/migrate";

describe("local database connection URLs", () => {
  it("derives the host migration URL from its role password", () => {
    expect(
      resolveMigrationConnectionString({
        NODE_ENV: "development",
        MIGRATION_DB_PASSWORD: "migration:local/password",
      }),
    ).toBe(
      "postgresql://onholidai_migration:migration%3Alocal%2Fpassword@localhost:5432/onholidai",
    );
  });

  it("prefers an explicit migration URL", () => {
    expect(
      resolveMigrationConnectionString({
        NODE_ENV: "development",
        MIGRATION_DATABASE_URL: "postgresql://migration@custom-host/database",
        MIGRATION_DB_PASSWORD: "unused-local-password",
      }),
    ).toBe("postgresql://migration@custom-host/database");
  });

  it("does not derive a local URL for production", () => {
    expect(
      resolveMigrationConnectionString({
        NODE_ENV: "production",
        MIGRATION_DB_PASSWORD: "unused-local-password",
        DATABASE_URL: "postgresql://migration@production-host/database",
      }),
    ).toBe("postgresql://migration@production-host/database");
  });
});
