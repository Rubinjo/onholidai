import { defineConfig, devices } from "@playwright/test";

const ci = Boolean(process.env.CI);
const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ?? (ci ? "https://localhost:3000" : "http://localhost:3000");
const agentBaseURL = process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8000";
const agentPort = new URL(agentBaseURL).port || "8000";
const callbackURL = ci ? `http://127.0.0.1:${Number(new URL(baseURL).port || "443") + 1}` : baseURL;
const localCertificate = ci || process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: ci,
  workers: ci ? 1 : undefined,
  retries: 0,
  maxFailures: ci ? 5 : undefined,
  globalTimeout: ci ? 17 * 60_000 : undefined,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    ...(process.env.US1_STORAGE_STATE ? { storageState: process.env.US1_STORAGE_STATE } : {}),
    baseURL,
    ignoreHTTPSErrors: localCertificate,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: `uv run --project agent uvicorn onholidai_agent.api.main:app --host 127.0.0.1 --port ${agentPort}`,
      cwd: "..",
      url: `${agentBaseURL}/health`,
      env: {
        PROVIDER_MODE: "deterministic",
        WEB_BASE_URL: callbackURL,
        LANGSMITH_TRACING: "false",
      },
      reuseExistingServer: !ci,
      timeout: 120_000,
    },
    {
      command: ci ? "node tests/e2e/production-server.mjs" : "pnpm dev",
      url: `${baseURL}/api/health`,
      ignoreHTTPSErrors: localCertificate,
      // Browser suites open many guest planning sessions from one network. The
      // production default is intentionally lower than this test-only allowance.
      env: {
        ...(ci ? { NODE_ENV: "production" } : {}),
        BETTER_AUTH_URL: baseURL,
        AGENT_BASE_URL: agentBaseURL,
        PROVIDER_MODE: "deterministic",
        GUEST_MAX_SESSIONS_PER_HOUR: "200",
      },
      reuseExistingServer: !ci,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] } },
  ],
});
