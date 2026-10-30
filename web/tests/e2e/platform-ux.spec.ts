import { expect, test } from "@playwright/test";

import { mockSetup } from "../helpers/mock-setup";
import {
  addDestination,
  calendarDate,
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
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(
        scrollWidth,
        `${path} should fit the layout viewport (${scrollWidth}px content, ${clientWidth}px viewport)`,
      ).toBeLessThanOrEqual(clientWidth);
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
    await page.clock.setFixedTime(new Date("2026-10-27T12:00:00Z"));
    await page.emulateMedia({ reducedMotion });
    const unmockedRequests: string[] = [];
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      unmockedRequests.push(path);
      return route.fulfill({
        status: 501,
        json: { title: `Missing deterministic setup mock: ${path}` },
      });
    });
    await mockSetup(page);
    await openBuilder(page);
    const samples: InputTiming[] = [];
    await page.getByLabel("Destination search").fill("Tokyo");
    await acknowledge(
      samples,
      "destination search",
      { target: page.getByLabel("Destination search"), key: "Enter" },
      { selector: '[role="listbox"][aria-label="Destination matches"]' },
      () => expect(page.getByRole("listbox", { name: "Destination matches" })).toBeVisible(),
    );
    await acknowledge(
      samples,
      "select destination",
      { target: page.getByRole("option", { name: /Tokyo.*JP/ }) },
      { selector: 'button[aria-label="Remove Tokyo"]' },
      () => expect(page.getByRole("button", { name: "Remove Tokyo" })).toBeVisible(),
    );
    await acknowledge(
      samples,
      "reset destinations",
      { target: page.getByRole("button", { name: "Reset destinations" }) },
      { selector: '[role="status"]', text: "Destinations cleared." },
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
      samples,
      "reorder destination",
      { target: handle, key: "ArrowUp" },
      { selector: '[aria-label="Selected destinations"] > li:first-child', text: "Kyoto" },
      () =>
        expect(
          page.getByRole("list", { name: "Selected destinations" }).getByRole("listitem").first(),
        ).toContainText("Kyoto"),
    );
    await acknowledge(
      samples,
      "order mode",
      { target: page.getByRole("button", { name: "Let AI arrange" }) },
      { selector: 'button[aria-pressed="true"]', text: "Let AI arrange" },
      () =>
        expect(page.getByRole("button", { name: "Let AI arrange" })).toHaveAttribute(
          "aria-pressed",
          "true",
        ),
    );
    await acknowledge(
      samples,
      "step navigation",
      { target: page.getByRole("button", { name: "Continue", exact: true }) },
      { selector: '[aria-label="Departure search"]' },
      () => expect(page.getByLabel("Departure search")).toBeVisible(),
    );
    await confirmOrigin(page);
    await continueStep(page);
    const start = await calendarDate(page, "2030-05-02");
    await acknowledge(
      samples,
      "calendar range start",
      { target: start },
      { selector: ".rdp-footer", text: "Choose an end date" },
      () => expect(page.locator(".rdp-footer")).toContainText("Choose an end date"),
    );
    const end = await calendarDate(page, "2030-05-16");
    await acknowledge(
      samples,
      "calendar range end",
      { target: end },
      { selector: ".availability-window", text: "16 May 2030" },
      () =>
        expect(page.locator(".availability-window").first()).toContainText(
          /2 May 2030.*16 May 2030/,
        ),
    );
    const minimum = page.getByRole("slider", { name: "Minimum days" });
    await minimum.focus();
    await acknowledge(
      samples,
      "duration handle",
      { target: minimum, key: "ArrowRight" },
      { selector: 'input[aria-label="Minimum days"]', value: "2" },
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
      samples,
      "travel preference",
      { target: pace, key: "ArrowRight" },
      { selector: 'input[id$="-pace"]', value: "6" },
      () => expect(pace).toHaveValue("6"),
    );
    expect(unmockedRequests, "All timing-test API inputs must be deterministic").toEqual([]);
    await test.info().attach("input-timings.json", {
      body: JSON.stringify({ reducedMotion, samples }),
      contentType: "application/json",
    });
  });
}
