import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PERF_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/performance",
  fullyParallel: false,
  timeout: 90_000,
  use: { baseURL, ...devices["Desktop Chrome"] },
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}/api/health`,
    env: { BETTER_AUTH_URL: baseURL, PROVIDER_MODE: "deterministic" },
    reuseExistingServer: true,
  },
});
