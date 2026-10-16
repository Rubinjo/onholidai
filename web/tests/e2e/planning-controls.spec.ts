import { expect, test } from "@playwright/test";
import { mockSetup } from "../helpers/mock-setup";
import { addDestination, confirmOrigin, continueStep, enterValue, openBuilder } from "../helpers/setup-wizard";
test.use({ storageState: { cookies: [], origins: [] } });
for (const width of [320, 390, 768, 1440]) test(`fixture-backed controls at ${width}px preserve choices and respond promptly`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 }); await mockSetup(page); await openBuilder(page);
  const timings: { action: string; milliseconds: number }[] = [];
  const started = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Let AI arrange" }).click();
  await expect(page.getByRole("button", { name: "Let AI arrange" })).toHaveAttribute("aria-pressed", "true");
  timings.push({ action: "order toggle", milliseconds: await page.evaluate(() => performance.now()) - started });
  await addDestination(page, "Japan", "JP"); await addDestination(page, "Tokyo", "JP");
  await expect(page.getByRole("button", { name: "Remove Japan" })).toHaveCount(0);
  await addDestination(page, "Kyoto", "JP");
  await page.getByRole("button", { name: "My order" }).click();
  const handle = page.getByRole("button", { name: "Reorder Kyoto; use arrow keys" }); await handle.focus(); await handle.press("ArrowUp");
  await expect(page.getByRole("list", { name: "Selected destinations" }).getByRole("listitem").first()).toContainText("Kyoto");
  await continueStep(page); await confirmOrigin(page); await confirmOrigin(page, "London", "London, GB");
  await expect(page.locator(".departure-cards li")).toHaveCount(2);
  await continueStep(page);
  await expect(page.locator(".availability-calendar")).toBeVisible();
  await enterValue(page.getByLabel("Start date 1"), "2030-05-01"); await enterValue(page.getByLabel("End date 1"), "2030-05-25");
  await enterValue(page.getByRole("slider", { name: "Minimum days" }), "5");
  await enterValue(page.getByRole("slider", { name: "Ideal days" }), "7");
  await enterValue(page.getByRole("slider", { name: "Maximum days" }), "9");
  await page.getByRole("button", { name: "Add availability window" }).click();
  await enterValue(page.getByLabel("Start date 2"), "2030-06-01"); await enterValue(page.getByLabel("End date 2"), "2030-06-25");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const timing of timings) expect(timing.milliseconds).toBeLessThanOrEqual(1000);
  await test.info().attach("input-timings.json", { body: JSON.stringify(timings), contentType: "application/json" });
  await page.screenshot({ path: test.info().outputPath(`dates-${width}.png`), fullPage: true });
});
test("reset ignores pending search, keeps order mode and restores the empty route", async ({ page }) => {
  await mockSetup(page); await openBuilder(page); await addDestination(page, "Tokyo", "JP");
  await page.getByRole("button", { name: "Let AI arrange" }).click();
  await page.getByRole("button", { name: "Reset destinations" }).click();
  await expect(page.getByRole("list", { name: "Selected destinations" }).getByRole("listitem")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Let AI arrange" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Continue", exact: true }).click(); await expect(page.getByLabel("Destination search")).toBeFocused();
});

test("route cards reorder with pointer drag and a supported mobile touch gesture", async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1440, height: 1400 }); await mockSetup(page); await openBuilder(page);
  await addDestination(page, "Tokyo", "JP"); await addDestination(page, "Kyoto", "JP");
  const route = page.getByRole("list", { name: "Selected destinations" });
  const handle = page.getByRole("button", { name: "Reorder Tokyo; use arrow keys" });
  await handle.scrollIntoViewIfNeeded();
  const start = (await handle.boundingBox())!, end = (await route.getByRole("listitem").filter({ hasText: "Kyoto" }).boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2); await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 5 }); await page.mouse.up();
  await expect(route.getByRole("listitem").first()).toContainText("Kyoto");
  if (browserName === "chromium" && test.info().project.name === "mobile-chromium") {
    const touchStart = (await page.getByRole("button", { name: "Reorder Kyoto; use arrow keys" }).boundingBox())!;
    const touchEnd = (await route.getByRole("listitem").filter({ hasText: "Tokyo" }).boundingBox())!;
    const session = await page.context().newCDPSession(page);
    try {
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: touchStart.x + touchStart.width / 2, y: touchStart.y + touchStart.height / 2, id: 1 }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: touchEnd.x + touchEnd.width / 2, y: touchEnd.y + touchEnd.height / 2, id: 1 }] });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(route.getByRole("listitem").first()).toContainText("Tokyo");
    } finally { await session.detach(); }
  }
});
