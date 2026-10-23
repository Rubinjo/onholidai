import { expect, test } from "@playwright/test";
import { z } from "zod";

import {
  seedBrowserWholeTrip,
  recordedWholeTripCommand,
  wholeTripInspectionSchema,
} from "./whole-trip-fixture";

test.describe("US3 recorded whole-trip review", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(120_000);
  test("complete review, keyboard consent, exact durable replay, expiry and reload without provider execution", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Whole-trip browser review requires a baseURL");
    const fixture = await seedBrowserWholeTrip(page, baseURL);
    const inspect = async () =>
      wholeTripInspectionSchema.parse(
        await recordedWholeTripCommand({
          action: "inspect",
          ownerUserId: fixture.ownerUserId,
          tripId: fixture.tripId,
        }),
      );
    let authorizations = 0,
      starts = 0;
    let startRequest: unknown;
    await page.route(`**/api/v1/trips/${fixture.tripId}/booking/authorizations`, async (route) => {
      authorizations++;
      const result = await recordedWholeTripCommand({
        action: "authorize",
        ownerUserId: fixture.ownerUserId,
        tripId: fixture.tripId,
        request: route.request().postDataJSON(),
      });
      await route.fulfill({ status: 201, json: result });
    });
    await page.route(`**/api/v1/trips/${fixture.tripId}/bookings`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      starts++;
      startRequest = route.request().postDataJSON();
      const result = await recordedWholeTripCommand({
        action: "start",
        ownerUserId: fixture.ownerUserId,
        tripId: fixture.tripId,
        request: startRequest,
      });
      await route.fulfill({ status: 202, json: result });
    });
    await page.goto(`/trips/${fixture.tripId}/booking`);
    await expect(page.getByRole("heading", { name: "Your whole trip" })).toBeVisible();
    await expect(page.getByText(/Remaining payable: £400.00/)).toBeVisible();
    await expect(page.getByText(/Selected room references/)).toBeVisible();
    await expect(page.getByText(/Changed from accepted estimate/)).toContainText(
      "£95.00 to current price £100.00",
    );
    await expect(page.getByRole("button", { name: /book selected|buy component/i })).toHaveCount(0);
    expect(await inspect()).toMatchObject({
      authorizations: 0,
      transactions: 0,
      attempts: 0,
      outbox: 0,
    });
    await page.setViewportSize({ width: 320, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const consent = page.getByRole("button", { name: "Authorize and start whole-trip booking" });
    await expect(consent).toBeEnabled();
    await consent.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/No services were attempted/)).toBeVisible({ timeout: 35_000 });
    expect(authorizations).toBe(1);
    expect(starts).toBe(1);
    const recorded = await inspect();
    expect(recorded).toMatchObject({ authorizations: 1, transactions: 1, attempts: 0, outbox: 1 });
    await recordedWholeTripCommand({
      action: "start",
      ownerUserId: fixture.ownerUserId,
      tripId: fixture.tripId,
      request: startRequest,
    });
    expect(await inspect()).toMatchObject({
      authorizations: 1,
      transactions: 1,
      attempts: 0,
      outbox: 1,
    });
    await page.clock.setFixedTime(new Date(Date.parse(fixture.state.review!.expiresAt!) + 1));
    await expect(page.getByText(/These booking terms expired/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Booking progress" })).toBeVisible();
    await expect(page.getByText(/No services were attempted/)).toBeVisible();
    await expect(consent).toHaveCount(0);
    expect(authorizations).toBe(1);
    expect(starts).toBe(1);
  });

  test("missing return blocks all-trip consent on client and server without a subset escape", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Whole-trip browser review requires a baseURL");
    const fixture = await seedBrowserWholeTrip(page, baseURL, true);
    await page.goto(`/trips/${fixture.tripId}/booking`);
    await expect(page.getByRole("heading", { name: "Resolve before booking" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Authorize and start whole-trip booking" }),
    ).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    const response = await page.request.post(
      `/api/v1/trips/${fixture.tripId}/booking/authorizations`,
      {
        headers: { origin: new URL(baseURL).origin },
        data: {
          requestId: crypto.randomUUID(),
          tripVersion: 2,
          termsHash: fixture.state.review!.termsHash,
          operation: "book_trip",
          componentId: null,
          acknowledgedNonReversibleActions: [],
        },
      },
    );
    expect(response.status()).toBe(409);
    expect(z.object({ code: z.string() }).parse(await response.json()).code).toBe(
      "booking_coverage_changed",
    );
    const counts = wholeTripInspectionSchema.parse(
      await recordedWholeTripCommand({
        action: "inspect",
        ownerUserId: fixture.ownerUserId,
        tripId: fixture.tripId,
      }),
    );
    expect(counts).toMatchObject({ authorizations: 0, transactions: 0, attempts: 0, outbox: 0 });
  });
});

// Booking journeys need a finalized synthetic trip plus a running deterministic
// web/agent/Temporal stack, so they follow the US1/US3 fixture convention.
const bookingTripId = process.env.US4_BOOKING_TRIP_ID;
const requiresFixture = !bookingTripId || !process.env.US1_STORAGE_STATE;

test("@us4 @accessibility revalidate live terms, authorize exactly, and follow durable progress", async ({
  page,
}) => {
  test.skip(requiresFixture, "Requires an authenticated finalized trip fixture");
  await page.goto(`/trips/${bookingTripId}/booking`);
  await expect(page.getByRole("heading", { name: "Review booking" })).toBeVisible();
  await expect(
    page.getByText("This will not reserve anything until you authorize the displayed terms."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Revalidate availability and price" }).click();
  await expect(page.getByText("Checking live price and availability…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Live booking terms" })).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByText(/Live total: /)).toBeVisible();

  // Keyboard-only authorization of the exact reviewed terms.
  const authorize = page.getByRole("button", { name: "Authorize and book these exact terms" });
  await authorize.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Booking progress" })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByText(/^Status: /)).toBeVisible({ timeout: 10000 });
  const progress = page.getByRole("region", { name: "Booking progress" });
  await expect(progress).toContainText(/confirmed|unknown|failed|action_required|running/);
  await expect(page.getByText("Planning itinerary")).toBeHidden();
});

test("@us4 offers recovery, rescheduling and cancellation only for confirmed components", async ({
  page,
}) => {
  test.skip(requiresFixture, "Requires an authenticated finalized trip fixture");
  await page.goto(`/trips/${bookingTripId}/booking`);
  await page.getByRole("button", { name: "Revalidate availability and price" }).click();
  await expect(page.getByRole("heading", { name: "Live booking terms" })).toBeVisible({
    timeout: 20000,
  });
  await page.getByRole("button", { name: "Authorize and book these exact terms" }).click();
  const progress = page.getByRole("region", { name: "Booking progress" });
  await expect(progress).toBeVisible({ timeout: 10000 });

  const known = progress.getByText(/: (?:unknown|action_required)/);
  if (await known.count()) {
    await expect(
      progress.getByRole("button", { name: "Check provider status" }).first(),
    ).toBeVisible();
    await expect(progress).toContainText(/Check provider status|reconcil/i);
  }
  const confirmed = progress.getByText(/: confirmed/);
  if (await confirmed.count()) {
    await expect(
      page.getByRole("button", { name: "Review a separate rescheduling request" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review cancellation terms" }).first(),
    ).toBeVisible();
    // Unrelated confirmations stay visible while a single component is reviewed.
    const before = await progress.textContent();
    await page
      .getByRole("button", { name: "Review a separate rescheduling request" })
      .first()
      .click();
    await expect(page.getByText("Other confirmed components remain unchanged.")).toBeVisible();
    expect(await progress.textContent()).toBe(before);
  }
});
