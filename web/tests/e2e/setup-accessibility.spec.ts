import { expect, test } from "@playwright/test";
import { addDestination, confirmOrigin, continueStep, enterValue, openBuilder } from "../helpers/setup-wizard";

test("@accessibility @us1 setup remains labelled and usable without map", async ({ page, browserName }) => {
  test.skip(!process.env.US1_STORAGE_STATE, "Requires authenticated synthetic storage state");
  await openBuilder(page);
  // The builder leads with the globe; the labelled search controls remain the
  // non-map route and are asserted independently in the guest setup journey.
  await expect(page.getByRole("region", { name: "Globe destination picker" })).toBeVisible();
  // WebKit keeps Safari's default of tabbing through form controls only, so the
  // skip-link ordering assertion applies to engines that include links.
  if (browserName !== "webkit") {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  }

  await addDestination(page, "Tokyo", "JP");
  await continueStep(page);

  await expect(page.getByLabel("Departure search")).toBeVisible();
  await expect(page.getByRole("button", { name: "Search departure" })).toBeVisible();
  await confirmOrigin(page);
  await continueStep(page);

  await expect(page.getByLabel("Start date 1")).toBeVisible();
  await expect(page.getByLabel("Availability timezone 1")).toBeVisible();
  await expect(page.getByLabel("Minimum days", { exact: true })).toBeVisible();
  await enterValue(page.getByLabel("Start date 1"), "2030-05-01");
  await enterValue(page.getByLabel("End date 1"), "2030-05-20");
  await enterValue(page.getByLabel("Minimum days", { exact: true }), "5");
  await enterValue(page.getByLabel("Ideal days", { exact: true }), "7");
  await enterValue(page.getByLabel("Maximum days", { exact: true }), "8");
  await page.getByRole("button", { name: "Add availability window" }).click();
  await expect(page.getByLabel("Start date 2")).toBeVisible();
  await expect(page.getByLabel("End date 2")).toBeVisible();
  await enterValue(page.getByLabel("Start date 2"), "2030-06-01");
  await enterValue(page.getByLabel("End date 2"), "2030-06-20");
  await continueStep(page);

  await enterValue(page.getByLabel("Adults", { exact: true }), "2");
  await continueStep(page);

  await expect(page.getByLabel("Pace", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Spend", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Discovery", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Independence", { exact: false })).toBeVisible();
  await expect(page.getByLabel("Setting", { exact: false })).toBeVisible();
});
