import { expect, test } from "@playwright/test";

import {
  recordedWholeTripCommand,
  seedBrowserWholeTrip,
  wholeTripInspectionSchema,
} from "./whole-trip-fixture";

test.describe("Explicit browser-only booking demo", () => {
  test.skip(
    process.env.BOOKING_DEMO_ENABLED !== "true",
    "Requires a web server explicitly started with BOOKING_DEMO_ENABLED=true",
  );
  test.use({ storageState: { cookies: [], origins: [] } });
  test("reviews, simulates, resets and reloads without any booking API or persisted change", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("The demo browser check requires an isolated fixture origin");
    const seeded = await seedBrowserWholeTrip(page, baseURL);
    const inspect = async () =>
      wholeTripInspectionSchema.parse(
        await recordedWholeTripCommand({
          action: "inspect",
          ownerUserId: seeded.ownerUserId,
          tripId: seeded.tripId,
        }),
      );
    const before = await inspect();
    const requests: string[] = [];
    await page.route("**/api/v1/**", async (route) => {
      requests.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      await route.abort("blockedbyclient");
    });
    await page.goto(`/trips/${seeded.tripId}/booking`);
    await expect(page.getByRole("heading", { name: "Booking demo" })).toBeVisible();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 800 });
    const consent = page.getByRole("checkbox", { name: /I understand this is a demo/ });
    const book = page.getByRole("button", { name: "Book this trip" });
    await expect(book).toBeDisabled();
    await consent.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(book).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("Preparing your demo confirmation");
    const complete = page.getByRole("heading", { name: "Demo booking complete" });
    await expect(complete).toBeFocused();
    await expect(page.getByText(/No real reservation was made/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const again = page.getByRole("button", { name: "Preview again" });
    await again.focus();
    await page.keyboard.press("Enter");
    await expect(consent).not.toBeChecked();
    await expect(page.getByRole("heading", { name: "Review booking", exact: true })).toBeFocused();
    await page.setViewportSize({ width: 1280, height: 900 });
    await consent.check();
    await book.click();
    await expect(complete).toBeVisible();
    await page.reload();
    await expect(consent).not.toBeChecked();
    await expect(complete).toHaveCount(0);
    await expect(book).toBeDisabled();
    expect(requests).toEqual([]);
    expect(await inspect()).toEqual(before);
  });
});
