import { expect, test } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
for (const width of [320, 390, 768, 1440]) {
  test(`public journeys fit ${width}px and keep keyboard controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/", "/trips/new", "/sign-in", "/sign-up"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    }
  });
}
