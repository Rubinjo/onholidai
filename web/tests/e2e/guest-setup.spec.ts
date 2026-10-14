import { expect, test } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
test("guest setup is public and acknowledged destination changes survive refresh", async ({ page }) => {
  await page.goto("/trips/new");
  await expect(page.getByRole("heading", { name: "Where would you like to go?" })).toBeVisible();
  await page.getByLabel("Destination search").fill("Tokyo");
  await page.getByRole("button", { name: "Search destinations" }).click();
  await page.getByRole("button", { name: /Add Tokyo/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Selected destinations" })).toContainText("Tokyo");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Where are you starting?" })).toBeFocused();
  await expect(page).not.toHaveURL(/sign-in/);
});
test("search and list remain available when the globe fails", async ({ page }) => {
  await page.route("**/maps/countries.geojson", (route) => route.abort());
  await page.goto("/trips/new");
  await expect(page.getByLabel("Destination search")).toBeVisible();
  await page.getByLabel("Destination search").focus();
  await expect(page.getByLabel("Destination search")).toBeFocused();
});
