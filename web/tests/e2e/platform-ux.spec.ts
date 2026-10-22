import { expect, test } from "@playwright/test";

import { mockSetup } from "../helpers/mock-setup";
import {
  addDestination,
  confirmOrigin,
  continueStep,
  enterValue,
  openBuilder,
  selectAvailability,
} from "../helpers/setup-wizard";
import { acknowledge, type InputTiming } from "../helpers/input-timing";

test.use({ storageState: { cookies: [], origins: [] } });
for (const width of [320, 390, 768, 1440]) {
  test(`public journeys fit ${width}px and keep keyboard controls`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/", "/trips/new", "/sign-in", "/sign-up"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const skip = page.getByRole("link", { name: "Skip to main content" });
      // WebKit keeps Safari's default of tabbing through form controls only, so the
      // first-Tab ordering assertion applies to engines that include links.
      if (browserName !== "webkit") {
        await page.keyboard.press("Tab");
        await expect(skip).toBeFocused();
      }
      await skip.focus();
      await expect(skip).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.locator("#main-content")).toBeFocused();
    }
  });
}

for (const reducedMotion of ["no-preference", "reduce"] as const) {
  test(`setup acknowledges deterministic inputs within one second (${reducedMotion})`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion });
    await mockSetup(page);
    await openBuilder(page);
    const samples: InputTiming[] = [];
    await page.getByLabel("Destination search").fill("Tokyo");
    await acknowledge(
      page,
      samples,
      "destination search",
      () => page.getByLabel("Destination search").press("Enter"),
      () => expect(page.getByRole("listbox", { name: "Destination matches" })).toBeVisible(),
    );
    await acknowledge(
      page,
      samples,
      "select destination",
      () => page.getByRole("option", { name: /Tokyo.*JP/ }).click(),
      () => expect(page.getByRole("button", { name: "Remove Tokyo" })).toBeVisible(),
    );
    await acknowledge(
      page,
      samples,
      "reset destinations",
      () => page.getByRole("button", { name: "Reset destinations" }).click(),
      () =>
        expect(
          page.getByRole("list", { name: "Selected destinations" }).getByRole("listitem"),
        ).toHaveCount(0),
    );
    await addDestination(page, "Tokyo", "JP");
    await addDestination(page, "Kyoto", "JP");
    const handle = page.getByRole("button", { name: "Reorder Kyoto; use arrow keys" });
    await handle.focus();
    await acknowledge(
      page,
      samples,
      "reorder destination",
      () => handle.press("ArrowUp"),
      () =>
        expect(
          page.getByRole("list", { name: "Selected destinations" }).getByRole("listitem").first(),
        ).toContainText("Kyoto"),
    );
    await acknowledge(
      page,
      samples,
      "order mode",
      () => page.getByRole("button", { name: "Let AI arrange" }).click(),
      () =>
        expect(page.getByRole("button", { name: "Let AI arrange" })).toHaveAttribute(
          "aria-pressed",
          "true",
        ),
    );
    await acknowledge(
      page,
      samples,
      "step navigation",
      () => continueStep(page),
      () => expect(page.getByLabel("Departure search")).toBeVisible(),
    );
    await confirmOrigin(page);
    await continueStep(page);
    const days = page.locator(".rdp-day_button");
    await acknowledge(
      page,
      samples,
      "calendar range start",
      () => days.nth(1).click(),
      () => expect(page.locator(".rdp-footer")).toContainText("Choose an end date"),
    );
    await acknowledge(
      page,
      samples,
      "calendar range end",
      () => days.nth(15).click(),
      () => expect(page.locator(".availability-window").first()).not.toContainText("Choose dates"),
    );
    const minimum = page.getByRole("slider", { name: "Minimum days" });
    await minimum.focus();
    await acknowledge(
      page,
      samples,
      "duration handle",
      () => minimum.press("ArrowRight"),
      () => expect(minimum).toHaveValue("2"),
    );
    await page.getByRole("button", { name: "Reset calendar" }).click();
    await selectAvailability(page, "2030-05-01", "2030-05-25");
    await enterValue(page.getByRole("slider", { name: "Ideal days" }), "7");
    await enterValue(page.getByRole("slider", { name: "Maximum days" }), "9");
    await continueStep(page);
    await enterValue(page.getByLabel("Adults", { exact: true }), "2");
    await continueStep(page);
    const pace = page.getByRole("slider", { name: "Pace: relaxed to full days" });
    await pace.focus();
    await expect(pace).toHaveValue("5");
    await acknowledge(
      page,
      samples,
      "travel preference",
      () => pace.press("ArrowRight"),
      () => expect(pace).toHaveValue("6"),
    );
    await test.info().attach("input-timings.json", {
      body: JSON.stringify({ reducedMotion, samples }),
      contentType: "application/json",
    });
  });
}
