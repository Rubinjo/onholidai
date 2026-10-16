import { expect, test } from "@playwright/test";
import { completeSetup } from "../helpers/setup-wizard";

test.beforeEach(() => test.skip(!process.env.US1_STORAGE_STATE, "Requires migrated deterministic services and authenticated synthetic storage state"));
test("@us1 outage status preserves the saved setup without acceptance", async ({ page }) => {
  // Answer every status poll with a failed run. Deriving the envelope from the URLs avoids
  // re-reading an intercepted body, which the page can abandon while it navigates.
  await page.route("**/api/v1/agent-runs/*", async (route) => {
    const runId = new URL(route.request().url()).pathname.split("/").pop();
    const tripId = new URL(page.url()).pathname.split("/")[2];
    await route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ id: runId, tripId, status: "failed", result: null, interruptionReason: "deadline" }) });
  });
  await completeSetup(page);
  await expect(page.getByText(/Research status: failed/)).toBeVisible({ timeout: 35000 });
  await expect(page.getByRole("button", { name: "Accept this estimated draft" })).toHaveCount(0);
  await expect(page.getByText(/Saved version 1/)).toBeVisible();
  await expect(page.getByText("Tokyo, JP", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Saved version 1/)).toBeVisible();
});
test("@accessibility @us1 failed WebGL keeps the route list and acceptance usable", async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = () => null; });
  await completeSetup(page);
  await expect(page.getByRole("heading", { name: "Proposed estimate" })).toBeVisible({ timeout: 35000 });
  await page.getByRole("button", { name: "Show optional route map" }).click();
  await expect(page.getByText(/Map unavailable/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept this estimated draft" })).toBeEnabled();
  await expect(page.getByRole("heading", { name: "Route and duration allocation" })).toBeVisible();
});
