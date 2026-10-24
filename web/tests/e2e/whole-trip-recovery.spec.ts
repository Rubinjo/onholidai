import { expect, test } from "@playwright/test";

import { bookingReviewStateSchema } from "../../domain/booking/public";
import {
  recordedWholeTripCommand,
  seedBrowserWholeTrip,
  wholeTripInspectionSchema,
} from "./whole-trip-fixture";

test.describe("US4 durable whole-trip recovery review", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test.setTimeout(120_000);

  test("preserves a confirmed service through full remaining review, consent, child start and reload", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Whole-trip recovery requires an HTTPS fixture origin");
    const seeded = await seedBrowserWholeTrip(page, baseURL);
    const command = {
      ownerUserId: seeded.ownerUserId,
      tripId: seeded.tripId,
    };
    const recovery = bookingReviewStateSchema.parse(
      await recordedWholeTripCommand({
        action: "prepare-recovery",
        ...command,
        outcome: "failed",
      }),
    );
    const parent = recovery.latestAttempt;
    if (!parent) throw new Error("The recovery fixture must persist its parent attempt");
    const inspect = async () =>
      wholeTripInspectionSchema.parse(
        await recordedWholeTripCommand({ action: "inspect", ...command }),
      );
    let reviews = 0,
      consents = 0,
      starts = 0;
    await page.route(`**/api/v1/trips/${seeded.tripId}/booking/revalidations`, async (route) => {
      reviews++;
      const input = route.request().postDataJSON();
      expect(Object.keys(input).sort()).toEqual(["expectedVersion", "requestId"]);
      await route.fulfill({
        status: 202,
        json: await recordedWholeTripCommand({
          action: "review-remainder",
          ...command,
          request: input,
        }),
      });
    });
    await page.route(`**/api/v1/trips/${seeded.tripId}/booking/authorizations`, async (route) => {
      consents++;
      await route.fulfill({
        status: 201,
        json: await recordedWholeTripCommand({
          action: "authorize",
          ...command,
          request: route.request().postDataJSON(),
        }),
      });
    });
    await page.route(`**/api/v1/trips/${seeded.tripId}/bookings`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      starts++;
      await route.fulfill({
        status: 202,
        json: await recordedWholeTripCommand({
          action: "start",
          ...command,
          request: route.request().postDataJSON(),
        }),
      });
    });
    await page.goto(`/trips/${seeded.tripId}/booking`);
    await expect(page.getByRole("heading", { name: "Booking progress" })).toBeVisible();
    await expect(page.getByText(/recorded-recovery-confirmation/).first()).toBeVisible();
    await expect(page.getByText(/No services were attempted/)).toHaveCount(0);
    await expect(page.getByText(/Not booked; supplier reported failure/)).toBeVisible();
    await expect(page.getByText(/Not attempted; no booking was sent/)).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Authorize and start whole-trip booking" }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 800 });
    const review = page.getByRole("button", { name: "Review remaining whole trip" });
    await review.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Remaining payable: £300.00")).toBeVisible({ timeout: 35_000 });
    await expect(review).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const beforeConsent = await inspect();
    expect(beforeConsent).toMatchObject({
      transactions: 1,
      attempts: 2,
      authorizations: 1,
      outbox: 1,
    });
    expect(beforeConsent.review.review?.terms).toMatchObject({
      continuationOf: parent.id,
      rootAttemptId: parent.id,
      totalPrice: { currency: "GBP", minorUnits: 30000 },
    });
    const authorize = page.getByRole("button", { name: "Authorize and start whole-trip booking" });
    await authorize.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText(/This continues booking attempt/)).toContainText(parent.id, {
      timeout: 35_000,
    });
    const persisted = await inspect();
    expect(persisted).toMatchObject({
      transactions: 2,
      attempts: 2,
      authorizations: 2,
      outbox: 2,
    });
    const child = persisted.review.latestAttempt;
    expect(child?.continuationOf).toBe(parent.id);
    expect(child?.rootAttemptId).toBe(parent.id);
    expect(child?.components).toHaveLength(3);
    expect(
      child?.components.every(
        (component) => component.componentId !== recovery.confirmedCommitments[0].componentId,
      ),
    ).toBe(true);
    await page.reload();
    await expect(page.getByText(/This continues booking attempt/)).toContainText(parent.id);
    await expect(page.getByRole("heading", { name: "Saved confirmed commitments" })).toBeVisible();
    await expect(page.getByText(/recorded-recovery-confirmation/)).toBeVisible();
    expect({ reviews, consents, starts }).toEqual({ reviews: 1, consents: 1, starts: 1 });
    expect(await inspect()).toMatchObject({ transactions: 2, attempts: 2 });
    await expect(
      page.getByRole("button", { name: /book selected|retry booking|buy component/i }),
    ).toHaveCount(0);
  });

  test("restores an uncertain write with its saved commitment and no continuation or repeat-booking action", async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error("Whole-trip recovery requires an HTTPS fixture origin");
    const seeded = await seedBrowserWholeTrip(page, baseURL);
    const command = { ownerUserId: seeded.ownerUserId, tripId: seeded.tripId };
    await recordedWholeTripCommand({
      action: "prepare-recovery",
      ...command,
      outcome: "unknown",
    });
    await page.goto(`/trips/${seeded.tripId}/booking`);
    await expect(page.getByText(/Outcome uncertain; do not repeat this booking/)).toBeVisible();
    await expect(page.getByText(/recorded-recovery-confirmation/).first()).toBeVisible();
    await expect(page.getByText(/Quote booking attempt/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Check provider status" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review remaining whole trip" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Authorize and start whole-trip booking" }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 320, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.reload();
    await expect(page.getByText(/Outcome uncertain; do not repeat this booking/)).toBeVisible();
    const persisted = wholeTripInspectionSchema.parse(
      await recordedWholeTripCommand({ action: "inspect", ...command }),
    );
    expect(persisted).toMatchObject({ authorizations: 1, transactions: 1, attempts: 2, outbox: 1 });
    expect(persisted.review.confirmedCommitments).toHaveLength(1);
    await expect(
      page.getByRole("button", { name: /book selected|retry booking|buy component/i }),
    ).toHaveCount(0);
  });
});
