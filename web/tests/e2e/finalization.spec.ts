import { expect, test } from "@playwright/test";

test("@us3 @accessibility review a complete itinerary without a map and finalize explicitly", async ({ page }) => {
  test.skip(!process.env.US3_TRIP_ID || !process.env.US1_STORAGE_STATE, "Requires an authenticated seeded refined draft");
  await page.route("**/maps/**", (route) => route.abort());
  await page.goto(`/trips/${process.env.US3_TRIP_ID}`);
  await page.getByRole("button", { name: "Prepare detailed itinerary" }).click();
  await expect(page.getByRole("button", { name: "Accept proposal" })).toBeEnabled({ timeout: 35000 });
  await expect(page.getByRole("heading", { name: "Day-by-day itinerary" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await page.getByRole("button", { name: "Review finalization" }).click();
  await expect(page.getByRole("heading", { name: "Finalization review" })).toBeVisible();
  const conflicts = page.getByRole("region", { name: "Blocking conflicts" });
  if (await conflicts.locator("li").count()) {
    await expect(page.getByRole("button", { name: "Finalize planning itinerary" })).toBeDisabled();
    await expect(conflicts).toContainText(/resolve|move|remove|missing|conflict|required/i);
  } else {
    const acknowledgement = page.getByLabel("I have reviewed the unverified conditions and planning exceptions");
    await acknowledgement.focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Finalize planning itinerary" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Planning itinerary finalized" })).toBeVisible();
    await page.reload();
    await expect(page.getByText("Planning itinerary finalized; bookings remain unconfirmed.")).toBeVisible();
  }
  const versions = await page.locator("[data-trip-version]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-trip-version")));
  expect(new Set(versions).size).toBe(1);
  await expect(page.getByRole("button", { name: "Booking unavailable" })).toBeDisabled();
});

test("@us3 known hard conflicts and dense days remain drafts with actionable suggestions", async ({ page }) => {
  test.skip(!process.env.US3_CONFLICT_TRIP_ID || !process.env.US1_STORAGE_STATE, "Requires an authenticated dense-day/hard-conflict draft fixture");
  await page.goto(`/trips/${process.env.US3_CONFLICT_TRIP_ID}`);
  const before = await page.locator("[data-trip-version]").first().getAttribute("data-trip-version");
  await page.getByRole("button", { name: "Review finalization" }).click();
  const conflicts = page.getByRole("region", { name: "Blocking conflicts" });
  await expect(conflicts).toContainText(/move|remove|resolve/i);
  await expect(page.getByText(/Lower-priority activity exceeds/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize planning itinerary" })).toBeDisabled();
  await expect(page.locator("[data-trip-version]").first()).toHaveAttribute("data-trip-version", before!);
});
