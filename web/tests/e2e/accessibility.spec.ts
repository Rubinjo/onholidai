import { expect, test } from "@playwright/test";

test("@accessibility @cross-cutting workspace remains navigable with reduced motion and map failure", async ({ page, browserName, browser }) => {
  test.skip(!process.env.US2_TRIP_ID, "Requires an authenticated synthetic trip with refinement enabled");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route(/maplibre|mapbox|tile/i, (route) => route.abort());
  for (const width of [390, 195]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/trips/${process.env.US2_TRIP_ID}`);
    await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
    await page.getByText("Route, stays and transport details", { exact: true }).click();
    await expect(page.getByRole("region", { name: "Accessible route" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Your travel assistant" })).toBeVisible();
    await expect(page.getByRole("contentinfo", { name: "Current total and booking" })).toBeVisible();
    await expect(page.locator("body").evaluate((body) => body.scrollWidth <= body.clientWidth)).resolves.toBe(true);
    // WebKit keeps Safari's default of tabbing through form controls only, so the
    // skip-link ordering assertion applies to engines that include links.
    if (browserName !== "webkit") {
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    }
    await expect(page.locator("html")).toHaveCSS("scroll-behavior", "auto");
  }
  await test.info().attach("browser-version.txt", { body: `${browserName} ${browser.version()}`, contentType: "text/plain" });
});
