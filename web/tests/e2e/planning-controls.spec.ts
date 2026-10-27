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

test.use({ storageState: { cookies: [], origins: [] } });
test("city labels retain the map projection's anchor during zoom and drag", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Real WebGL projection regression runs in Chromium");
  await mockSetup(page);
  await openBuilder(page);
  await addDestination(page, "Tokyo", "JP");
  await addDestination(page, "Kyoto", "JP");
  const anchor = page.locator(".globe-city-anchor").first();
  await expect(anchor).toBeAttached();
  await expect(anchor).toHaveCSS("position", "absolute");
  const distanceFromProjection = () =>
    anchor.evaluate((element) => {
      const translate = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(
        (element as HTMLElement).style.transform,
      );
      if (!translate) return Infinity;
      const box = element.getBoundingClientRect(),
        parent = element.parentElement!.getBoundingClientRect();
      return Math.max(
        Math.abs(box.left + box.width / 2 - parent.left - Number(translate[1])),
        Math.abs(box.top - parent.top - Number(translate[2])),
      );
    });
  await expect.poll(distanceFromProjection).toBeLessThan(1);
  const canvas = page.locator(".destination-globe__canvas canvas");
  const beforeZoom = await anchor.getAttribute("style");
  await canvas.hover();
  await page.mouse.wheel(0, 600);
  await expect.poll(() => anchor.getAttribute("style")).not.toBe(beforeZoom);
  await expect.poll(distanceFromProjection).toBeLessThan(1);
  const beforeDrag = await anchor.getAttribute("style");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 35, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => anchor.getAttribute("style")).not.toBe(beforeDrag);
  await expect.poll(distanceFromProjection).toBeLessThan(1);
});
for (const width of [320, 390, 768, 1440])
  test(`fixture-backed controls at ${width}px preserve choices and respond promptly`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 960 });
    await mockSetup(page);
    await openBuilder(page);
    const timings: { action: string; milliseconds: number }[] = [];
    const toggle = page.getByRole("button", { name: "Let AI arrange" });
    // Measure input-to-painted-state in the browser; automation scrolling and
    // protocol round trips are not application acknowledgement time.
    await toggle.evaluate((button) => {
      button.addEventListener(
        "click",
        () => {
          const started = performance.now();
          const observer = new MutationObserver(() => {
            if (button.getAttribute("aria-pressed") === "true") {
              observer.disconnect();
              requestAnimationFrame(() => {
                button.dataset.acknowledgement = String(performance.now() - started);
              });
            }
          });
          observer.observe(button, { attributes: true, attributeFilter: ["aria-pressed"] });
        },
        { once: true, capture: true },
      );
    });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).toHaveAttribute("data-acknowledgement", /\d/);
    timings.push({
      action: "order toggle click-to-paint",
      milliseconds: Number(await toggle.getAttribute("data-acknowledgement")),
    });
    await addDestination(page, "Japan", "JP");
    await addDestination(page, "Tokyo", "JP");
    await expect(page.getByRole("button", { name: "Remove Japan" })).toHaveCount(0);
    await addDestination(page, "Kyoto", "JP");
    const manualOrder = page.getByRole("button", { name: "My order", exact: true });
    await manualOrder.press("Enter");
    await expect(manualOrder).toHaveAttribute("aria-pressed", "true");
    const handle = page.getByRole("button", { name: "Reorder Kyoto; use arrow keys" });
    await expect(handle).toBeEnabled();
    await handle.focus();
    await handle.press("ArrowUp");
    await expect(
      page.getByRole("list", { name: "Selected destinations" }).getByRole("listitem").first(),
    ).toContainText("Kyoto");
    await continueStep(page);
    await confirmOrigin(page);
    await confirmOrigin(page, "London", "London, GB");
    await expect(page.locator(".departure-cards li")).toHaveCount(2);
    await continueStep(page);
    await expect(page.locator(".availability-calendar")).toBeVisible();
    const controlsSeparated = await page.locator(".availability-calendar").evaluate((calendar) => {
      const selectors = [
        ".rdp-months_dropdown",
        ".rdp-years_dropdown",
        ".rdp-button_previous",
        ".rdp-button_next",
      ];
      const boxes = selectors.map((selector) =>
        calendar.querySelector(selector)!.getBoundingClientRect(),
      );
      return boxes.every((box, index) =>
        boxes
          .slice(index + 1)
          .every(
            (other) =>
              box.right <= other.left ||
              other.right <= box.left ||
              box.bottom <= other.top ||
              other.bottom <= box.top,
          ),
      );
    });
    expect(controlsSeparated).toBe(true);
    await selectAvailability(page, "2030-05-01", "2030-05-25");
    await enterValue(page.getByRole("slider", { name: "Minimum days" }), "5");
    await enterValue(page.getByRole("slider", { name: "Ideal days" }), "7");
    await enterValue(page.getByRole("slider", { name: "Maximum days" }), "9");
    await expect(page.locator(".duration-slider__selection")).toHaveCSS(
      "background-color",
      "rgb(8, 76, 58)",
    );
    expect(
      await page
        .locator(".duration-slider__selection")
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBeGreaterThan(0);
    await selectAvailability(page, "2030-06-01", "2030-06-25");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(
      await page
        .locator(".availability-calendar")
        .evaluate((calendar) => calendar.scrollWidth <= calendar.clientWidth),
    ).toBe(true);
    for (const timing of timings) expect(timing.milliseconds).toBeLessThanOrEqual(1000);
    await test.info().attach("input-timings.json", {
      body: JSON.stringify(timings),
      contentType: "application/json",
    });
    await page.screenshot({ path: test.info().outputPath(`dates-${width}.png`), fullPage: true });
  });
test("reset ignores pending search, keeps order mode and restores the empty route", async ({
  page,
}) => {
  await mockSetup(page);
  await openBuilder(page);
  await addDestination(page, "Tokyo", "JP");
  await page.getByRole("button", { name: "Let AI arrange" }).click();
  await page.getByRole("button", { name: "Reset destinations" }).click();
  await expect(
    page.getByRole("list", { name: "Selected destinations" }).getByRole("listitem"),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Let AI arrange" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByLabel("Destination search")).toBeFocused();
});

test("calendar merges, subtracts, caps duration and persists a complete reset", async ({
  page,
}) => {
  await mockSetup(page);
  await openBuilder(page);
  await addDestination(page, "Tokyo", "JP");
  await continueStep(page);
  await confirmOrigin(page);
  await continueStep(page);
  await selectAvailability(page, "2030-05-01", "2030-05-10");
  await selectAvailability(page, "2030-05-08", "2030-05-15");
  await expect(page.locator(".availability-window")).toHaveCount(1);
  await expect(page.getByRole("slider", { name: "Maximum days" })).toHaveAttribute("max", "15");
  await (await calendarDate(page, "2030-05-05")).click({ button: "right" });
  await expect(page.locator(".availability-window")).toHaveCount(2);
  await (await calendarDate(page, "2030-05-12")).click({ button: "right" });
  await expect(page.locator(".availability-window").first()).toContainText(
    "1 May 2030 – 4 May 2030",
  );
  await expect(page.locator(".availability-window").last()).toContainText(
    "13 May 2030 – 15 May 2030",
  );
  await expect(page.getByRole("slider", { name: "Maximum days" })).toHaveAttribute("max", "4");
  await expect(page.getByRole("slider", { name: "Maximum days" })).toHaveValue("4");
  await page.getByRole("button", { name: "Remove dates" }).click();
  await (await calendarDate(page, "2030-05-01")).press("Enter");
  await (await calendarDate(page, "2030-05-04")).press("Enter");
  await expect(page.locator(".availability-window")).toHaveCount(1);
  await page.getByLabel("Date preference 1").selectOption("flexible");
  const resetSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.request().postDataJSON()?.payload?.availabilityWindows?.length === 0 &&
      response.ok(),
  );
  await page.getByRole("button", { name: "Reset calendar" }).click();
  await expect(page.locator(".availability-window")).toHaveCount(0);
  await expect(page.getByRole("slider", { name: "Maximum days" })).toBeDisabled();
  await resetSaved;
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "When can you travel?" })).toBeVisible();
  await expect(page.locator(".availability-window")).toHaveCount(0);
});

test("six availability windows cycle five shades and preference sliders use integer defaults", async ({
  page,
}) => {
  await mockSetup(page);
  await openBuilder(page);
  await addDestination(page, "Tokyo", "JP");
  await continueStep(page);
  await confirmOrigin(page);
  await continueStep(page);
  for (let index = 0; index < 6; index++) {
    const first = String(index * 4 + 1).padStart(2, "0"),
      last = String(index * 4 + 3).padStart(2, "0");
    await selectAvailability(page, `2030-05-${first}`, `2030-05-${last}`);
  }
  const rows = page.locator(".availability-window");
  await expect(rows).toHaveCount(6);
  await expect(rows.nth(0)).toHaveClass(/calendar-window--0/);
  await expect(rows.nth(5)).toHaveClass(/calendar-window--0/);
  await continueStep(page);
  await enterValue(page.getByLabel("Adults", { exact: true }), "2");
  await continueStep(page);
  for (const slider of await page.getByRole("slider").all()) {
    await expect(slider).toHaveAttribute("step", "1");
    await expect(slider).toHaveValue("5");
    await slider.focus();
    await slider.press("ArrowRight");
    await expect(slider).toHaveValue("6");
  }
});

test("route cards reorder with pointer drag and a supported mobile touch gesture", async ({
  page,
  browserName,
}) => {
  await page.setViewportSize({ width: 1440, height: 1400 });
  await mockSetup(page);
  await openBuilder(page);
  await addDestination(page, "Tokyo", "JP");
  await addDestination(page, "Kyoto", "JP");
  const route = page.getByRole("list", { name: "Selected destinations" });
  const handle = page.getByRole("button", { name: "Reorder Tokyo; use arrow keys" });
  await route.scrollIntoViewIfNeeded();
  await expect(route).toBeInViewport({ ratio: 1 });
  const start = (await handle.boundingBox())!,
    end = (await route.getByRole("listitem").filter({ hasText: "Kyoto" }).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(route.getByRole("listitem").first()).toContainText("Kyoto");
  if (browserName === "chromium" && test.info().project.name === "mobile-chromium") {
    const touchStart = (await page
      .getByRole("button", { name: "Reorder Kyoto; use arrow keys" })
      .boundingBox())!;
    const touchEnd = (await route
      .getByRole("listitem")
      .filter({ hasText: "Tokyo" })
      .boundingBox())!;
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [
          {
            x: touchStart.x + touchStart.width / 2,
            y: touchStart.y + touchStart.height / 2,
            id: 1,
          },
        ],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: touchEnd.x + touchEnd.width / 2, y: touchEnd.y + touchEnd.height / 2, id: 1 },
        ],
      });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(route.getByRole("listitem").first()).toContainText("Tokyo");
    } finally {
      await session.detach();
    }
  }
});
