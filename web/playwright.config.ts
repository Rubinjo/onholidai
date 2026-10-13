import { defineConfig, devices } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    ...(process.env.US1_STORAGE_STATE ? { storageState: process.env.US1_STORAGE_STATE } : {}),
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}/api/health`,
    env: { BETTER_AUTH_URL: baseURL },
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
