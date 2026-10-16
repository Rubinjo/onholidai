import { expect, test, type Locator, type Page } from "@playwright/test";

// Both journeys commit and undo changes on their seeded trip, so each needs its own
// freshly seeded fixture; the seed script prints the two trip ids to export.
const requiresExclusiveTrip = "Requires an exclusive, freshly seeded US2 trip";

// WebKit discards values set before React hydrates a controlled field, so retry
// until the application accepts the value (and enables its submit control).
async function enterValue(field: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

async function enterMessage(field: Locator, submit: Locator, message: string): Promise<void> {
  await expect(async () => {
    await field.fill(message);
    await expect(submit).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

async function requestProposal(page: Page, message: string): Promise<void> {
  await enterMessage(page.getByLabel("Ask your travel assistant"),
    page.getByRole("button", { name: "Send message" }), message);
  await page.getByRole("button", { name: "Send message" }).click();
}

test("@us2 @accessibility automatic changes, concurrent edits and chat restoration keep panes coherent", async ({ page, browser }) => {
  test.skip(!process.env.US2_TRIP_ID || !process.env.US1_STORAGE_STATE, "Requires a seeded accepted synthetic estimate and authenticated storage state");
  test.skip(test.info().project.name !== "chromium", requiresExclusiveTrip);
  await page.goto(`/trips/${process.env.US2_TRIP_ID}`);
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  const base = Number(await page.locator("[data-trip-version]").first().getAttribute("data-trip-version"));
  await expect(page.getByRole("link", { name: "Book trip" })).toBeVisible();
  await requestProposal(page, "Add two nights in Kyoto and keep mornings free");
  await expect(page.getByText(`Committed version ${base + 1}`, { exact: false })).toBeVisible({ timeout: 35000 });
  const competitor = await browser.newContext({ storageState: process.env.US1_STORAGE_STATE });
  try {
    const other = await competitor.newPage();
    await other.goto(`/trips/${process.env.US2_TRIP_ID}`);
    await other.getByText("Travellers and travel style", { exact: true }).first().click();
    const adultsField = other.getByLabel("Adults", { exact: true });
    await expect(adultsField).toHaveValue(/\d+/);
    const adults = Number(await adultsField.inputValue());
    // Retry the whole direct edit until the reviewed impact exists: a value set
    // before hydration can leave the draft state behind the rendered input.
    await expect(async () => {
      await enterValue(adultsField, String(adults < 9 ? adults + 1 : adults - 1));
      await other.getByRole("button", { name: "Review edit impacts" }).click();
      await expect(other.getByRole("button", { name: "Accept reviewed edit" })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20000 });
    await other.getByRole("button", { name: "Accept reviewed edit" }).click();
    // Polling pauses while a page is not the active page, so return to the original
    // page as a user would; focus also triggers an immediate trip refetch, and the
    // window tolerates a loaded stack completing that round trip.
    await page.bringToFront();
    await expect(page.getByText(`Committed version ${base + 2}`, { exact: false })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: "Accept proposal" })).toHaveCount(0);
  } finally { await competitor.close(); }
  await requestProposal(page, "Add two nights in Kyoto and keep mornings free");
  await expect(page.getByText(`Committed version ${base + 3}`, { exact: false })).toBeVisible({ timeout: 35000 });
  await expect(async () => {
    const versions = await page.locator("[data-trip-version]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-trip-version")));
    expect(new Set(versions).size).toBe(1);
  }).toPass({ timeout: 2000 });
  // History reloads for the newly committed version; retry the whole interaction, since
  // a refetch can replace the list node between locating and clicking it.
  await expect(async () => {
    await page.getByRole("button", { name: `Restore trip to version ${base + 2}` }).click({ timeout: 3000 });
  }).toPass({ timeout: 25000 });
  await expect(page.getByText(`Committed version ${base + 4}`, { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Version history" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Restore trip to version ${base + 2}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your travel assistant" })).toBeVisible();
});

test("@us2 @accessibility focused clarification resumes with original intent and map failure preserves the list", async ({ page }) => {
  test.skip(!process.env.US2_REFINEMENT_TRIP_ID || !process.env.US1_STORAGE_STATE, "Requires its own freshly seeded multi-destination estimate and authenticated storage state");
  test.skip(test.info().project.name !== "chromium", requiresExclusiveTrip);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/maps/countries.geojson", (route) => route.abort());
  await page.goto(`/trips/${process.env.US2_REFINEMENT_TRIP_ID}`);
  const base = Number(await page.locator("[data-trip-version]").first().getAttribute("data-trip-version"));
  await page.getByText("Route, stays and transport details", { exact: true }).click();
  await expect(page.getByRole("region", { name: "Accessible route" })).toBeVisible();
  await requestProposal(page, "Add two nights there");
  const answer = page.getByLabel("Which destination should receive the extra nights?");
  await expect(answer).toBeVisible({ timeout: 35000 });
  await answer.fill("Kyoto");
  await page.getByRole("button", { name: "Send clarification" }).click();
  await expect(page.getByText(`Committed version ${base + 1}`, { exact: false })).toBeVisible({ timeout: 35000 });
  await page.getByRole("button", { name: `Restore trip to version ${base}` }).click();
  await page.setViewportSize({ width: 400, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.getByRole("link", { name: "Book trip" })).toBeVisible();
  await page.getByLabel("Ask your travel assistant").fill("Set pace to 25");
  await page.getByLabel("Ask your travel assistant").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Send message" })).toBeFocused();
});
