import { expect, test } from "@playwright/test";
import { completeSetup } from "../helpers/setup-wizard";

// Run with a signed-in synthetic storage state and migrated deterministic services.
test("@us1 research requires explicit acceptance and survives reload", async ({ page }) => {
  test.skip(!process.env.US1_STORAGE_STATE, "Requires an authenticated synthetic account");
  await completeSetup(page);
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible({ timeout: 35000 });
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize your trip to enable booking" })).toBeDisabled();
});
