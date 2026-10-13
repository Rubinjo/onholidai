import { expect, test } from "@playwright/test";
test("@accessibility @us1 setup remains labelled and usable without map", async ({ page }) => {
  test.skip(!process.env.US1_STORAGE_STATE, "Requires authenticated synthetic storage state");
  await page.goto("/trips/new");
  await expect(page.getByLabel("Adults")).toBeVisible();
  await expect(page.getByLabel("Pace")).toBeVisible();
  await expect(page.getByLabel("Availability timezone 1")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.getByRole("button", { name: "Add availability window" }).click();
  await expect(page.getByLabel("Start date 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show optional route map" })).toBeVisible();
});
