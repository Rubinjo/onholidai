import { defineConfig } from "vitest/config";

import sharedConfig from "./vitest.config";

const requiredCredentials = [
  "TEST_DATABASE_ADMIN_URL", "TEST_DATABASE_MIGRATION_URL",
  "TEST_DATABASE_APP_URL", "TEST_DATABASE_WORKER_URL",
];
const missing = requiredCredentials.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(`Foundation checks require isolated PostgreSQL credentials: ${missing.join(", ")}`);
}

export default defineConfig({
  ...sharedConfig,
  test: {
    ...sharedConfig.test,
    environment: "node",
    include: [
      "tests/integration/migration-compatibility.test.ts",
      "tests/integration/trip-commit.test.ts",
      "tests/integration/trip-planning.test.ts",
    ],
  },
});
