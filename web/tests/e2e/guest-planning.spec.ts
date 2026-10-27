import { expect, test } from "@playwright/test";

import { completeSetup, savedVersion } from "../helpers/setup-wizard";
import { acknowledge, type InputTiming } from "../helpers/input-timing";

test.use({ storageState: { cookies: [], origins: [] } });
test("an unknown private trip shows an access outcome without disclosing content", async ({
  page,
}) => {
  await page.goto("/trips/10000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("heading", { name: "Private plan unavailable" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a new plan" })).toHaveAttribute(
    "href",
    "/trips/new",
  );
});

for (const reducedMotion of ["no-preference", "reduce"] as const)
  test(`a fresh guest can ask, automatically refine, reload and restore without exposing the private trip (${reducedMotion})`, async ({
    page,
    browser,
  }) => {
    test.setTimeout(120000);
    await page.emulateMedia({ reducedMotion });
    const timings: InputTiming[] = [];
    await completeSetup(page, { title: "Guest refinement journey" });
    await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible({
      timeout: 35000,
    });
    await expect(savedVersion(page, 2)).toBeVisible({ timeout: 35000 });
    await expect(page.getByRole("button", { name: "Accept proposal" })).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath("workspace-accepted-estimate.png"),
      fullPage: true,
    });
    const tripId = new URL(page.url()).pathname.split("/")[2];
    const original = await (await page.request.get(`/api/v1/trips/${tripId}`)).json();
    expect(original.version).toBe(2);
    await page
      .getByLabel("Ask your travel assistant")
      .fill("What are my options for this holiday?");
    const answerRun = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url().endsWith("/agent-runs"),
    );
    await acknowledge(
      timings,
      "chat send",
      { target: page.getByRole("button", { name: "Send message" }) },
      { selector: '[role="status"]', text: "Sending your request" },
      () =>
        expect(page.getByRole("status").filter({ hasText: "Sending your request" })).toBeVisible(),
    );
    const answerId = (await (await answerRun).json()).id;
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/v1/agent-runs/${answerId}`)).json()).status,
        { timeout: 35000 },
      )
      .toBe("completed");
    expect((await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).version).toBe(2);
    await page.getByLabel("Ask your travel assistant").fill("Set pace to 25");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(savedVersion(page, 3)).toBeVisible({ timeout: 35000 });
    await page.route("**/maps/countries.geojson", (route) => route.abort());
    await page.reload();
    await expect(savedVersion(page, 3)).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Compare supplier options", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Research estimate|Research route options/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Restore trip to version 2" }).click();
    await expect(savedVersion(page, 4)).toBeVisible();
    expect((await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).snapshot).toEqual(
      original.snapshot,
    );
    const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const stranger = await other.newPage();
      await stranger.goto(`/trips/${tripId}`);
      await expect(
        stranger.getByRole("heading", { name: "Private plan unavailable" }),
      ).toBeVisible();
      expect((await other.request.get(`/api/v1/trips/${tripId}/versions`)).status()).toBe(404);
    } finally {
      await other.close();
    }
    expect(
      (
        await page.request.post(`/api/v1/trips/${tripId}/booking/revalidations`, {
          headers: { origin: new URL(page.url()).origin },
          data: { requestId: crypto.randomUUID(), expectedVersion: 4 },
        })
      ).status(),
    ).toBe(401);
    await page.screenshot({ path: test.info().outputPath("guest-workspace.png"), fullPage: true });
    await test.info().attach("input-timings.json", {
      body: JSON.stringify(timings),
      contentType: "application/json",
    });
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await expect(page.getByLabel("Ask your travel assistant")).toBeVisible();
    }
  });
