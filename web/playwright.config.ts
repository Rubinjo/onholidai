import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
// Opt-in only for the locally generated HTTPS verification certificate. Keep
// ordinary browser runs' certificate validation enabled.
const localCertificate = process.env.PLAYWRIGHT_IGNORE_HTTPS_ERRORS === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    ...(process.env.US1_STORAGE_STATE ? { storageState: process.env.US1_STORAGE_STATE } : {}),
    baseURL,
    ignoreHTTPSErrors: localCertificate,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}/api/health`,
    ignoreHTTPSErrors: localCertificate,
    // Browser suites open many guest planning sessions from one network. The
    // conservative production default shares a single bucket per unknown network,
    // so the test server raises only that bootstrap allowance.
    env: { BETTER_AUTH_URL: baseURL, GUEST_MAX_SESSIONS_PER_HOUR: "200" },
    reuseExistingServer: true,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] } },
  ],
});
