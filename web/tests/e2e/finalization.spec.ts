import { expect, test } from "@playwright/test";

test("@us3 @accessibility prepare and review an itinerary on the booking page without a map", async ({
  page,
}) => {
  test.skip(
    !process.env.US3_TRIP_ID || !process.env.US1_STORAGE_STATE,
    "Requires an authenticated seeded refined draft",
  );
  await page.route("**/maps/**", (route) => route.abort());
  await page.goto(`/trips/${process.env.US3_TRIP_ID}`);
  await expect(page.getByRole("heading", { name: "Finalization review" })).toHaveCount(0);
  await page.getByRole("link", { name: "Book trip" }).click();
  await expect(page.getByRole("heading", { name: "Review booking" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare itinerary for review" }).click();
  await expect(page.getByRole("button", { name: "Prepare itinerary for review" })).toHaveCount(0, {
    timeout: 35000,
  });
  const next = page.getByRole("button", { name: "Continue to live terms" });
  if (await page.getByRole("heading", { name: "Resolve before booking" }).count()) {
    await expect(next).toBeDisabled();
    await expect(page.locator(".booking-readiness")).toContainText(
      /resolve|move|remove|missing|conflict|required/i,
    );
  } else {
    const acknowledgement = page.getByRole("checkbox");
    if (await acknowledgement.count()) {
      await acknowledgement.focus();
      await page.keyboard.press("Space");
    }
    await next.click();
    await expect(
      page.getByRole("button", { name: "Revalidate availability and price" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Revalidate availability and price" }),
    ).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Authorize/ })).toHaveCount(0);
});

test("@us3 known hard conflicts and dense days remain drafts with actionable suggestions", async ({
  page,
}) => {
  test.skip(
    !process.env.US3_CONFLICT_TRIP_ID || !process.env.US1_STORAGE_STATE,
    "Requires an authenticated dense-day/hard-conflict draft fixture",
  );
  await page.goto(`/trips/${process.env.US3_CONFLICT_TRIP_ID}`);
  const tripPath = `/api/v1/trips/${process.env.US3_CONFLICT_TRIP_ID}`;
  const before = (await (await page.request.get(tripPath)).json()).version;
  await page.getByRole("link", { name: "Book trip" }).click();
  const conflicts = page.locator(".booking-readiness");
  await expect(conflicts).toContainText(/move|remove|resolve/i);
  await expect(page.getByText(/Lower-priority activity exceeds/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue to live terms" })).toBeDisabled();
  expect((await (await page.request.get(tripPath)).json()).version).toBe(before);
});
