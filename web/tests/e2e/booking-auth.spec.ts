import { expect, test } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
test("free registration asks for identity only and offers an existing-account path", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in instead" })).toHaveAttribute("href", /sign-in/);
  await expect(page.locator('input[name*="payment"],input[name*="card"]')).toHaveCount(0);
});
