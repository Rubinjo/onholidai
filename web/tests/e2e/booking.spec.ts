import { expect, test } from "@playwright/test";

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
