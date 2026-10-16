import { expect, test } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
for (const width of [320, 390, 768, 1440]) {
  test(`public journeys fit ${width}px and keep keyboard controls`, async ({ page, browserName }) => {
    await page.setViewportSize({ width, height: 900 }); await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/", "/trips/new", "/sign-in", "/sign-up"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const skip = page.getByRole("link", { name: "Skip to main content" });
      // WebKit keeps Safari's default of tabbing through form controls only, so the
      // first-Tab ordering assertion applies to engines that include links.
      if (browserName !== "webkit") { await page.keyboard.press("Tab"); await expect(skip).toBeFocused(); }
      await skip.focus();
      await expect(skip).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main-content")).toBeFocused();
    }
  });
}
