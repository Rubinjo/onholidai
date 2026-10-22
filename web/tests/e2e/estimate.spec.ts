import { expect, test } from "@playwright/test";

import { completeSetup, savedVersion } from "../helpers/setup-wizard";

// Run with a signed-in synthetic storage state and migrated deterministic services.
test("@us1 research applies a validated estimate automatically and survives reload", async ({
  page,
}) => {
  test.skip(!process.env.US1_STORAGE_STATE, "Requires an authenticated synthetic account");
  await completeSetup(page);
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await expect(savedVersion(page, 2)).toBeVisible({ timeout: 35000 });
  await expect(page.getByRole("button", { name: "Accept proposal" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Book trip" })).toBeVisible();
});
