import { expect, test } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
test("an unknown private trip shows an access outcome without disclosing content", async ({ page }) => {
  await page.goto("/trips/10000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("heading", { name: "Private plan unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a new plan" })).toHaveAttribute("href", "/trips/new");
});
