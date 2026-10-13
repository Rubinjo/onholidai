import { expect, test } from "@playwright/test";

// Run with a signed-in synthetic storage state and migrated deterministic services.
test("@us1 research requires explicit acceptance and survives reload", async ({ page }) => {
  test.skip(!process.env.US1_STORAGE_STATE, "Requires an authenticated synthetic account");
  await page.goto("/trips/new");
  await page.getByLabel("Departure search").fill("Amsterdam");
  await page.getByRole("button", { name: "Search departure" }).click();
  await page.getByRole("button", { name: /Confirm departure from Amsterdam, NL/ }).click();
  await page.getByLabel("Destination search").fill("Tokyo");
  await page.getByRole("button", { name: "Search destinations" }).click();
  await page.getByRole("button", { name: /Add Tokyo, JP/ }).click();
  await page.getByLabel("Start date 1").fill("2030-05-01");
  await page.getByLabel("End date 1").fill("2030-05-20");
  await page.getByRole("button", { name: "Create trip and research estimate" }).click();
  await expect(page.getByRole("heading", { name: "Proposed estimate" })).toBeVisible({ timeout: 35000 });
  await expect(page.getByText("Nothing has been applied yet.")).toBeVisible();
  await page.getByRole("button", { name: "Accept this estimated draft" }).click();
  await expect(page.getByRole("heading", { name: "Accepted estimated draft" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Accepted estimated draft" })).toBeVisible();
  await expect(page.getByText(/Booking is not available/)).toBeVisible();
});
