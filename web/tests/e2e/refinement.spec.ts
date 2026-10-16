import { expect, test, type Locator, type Page } from "@playwright/test";
import { routeMapToggle } from "../helpers/setup-wizard";

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
  await enterMessage(page.getByLabel("Discuss a trip change"),
    page.getByRole("button", { name: "Request a proposal" }), message);
  await page.getByRole("button", { name: "Request a proposal" }).click();
}

test("@us2 @accessibility review, conflict, history and undo keep the committed panes coherent", async ({ page, browser }) => {
  test.skip(!process.env.US2_TRIP_ID || !process.env.US1_STORAGE_STATE, "Requires a seeded accepted synthetic estimate and authenticated storage state");
  test.skip(test.info().project.name !== "chromium", requiresExclusiveTrip);
  await page.goto(`/trips/${process.env.US2_TRIP_ID}`);
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Finalize your trip to enable booking" })).toBeDisabled();
  await requestProposal(page, "Add two nights in Kyoto and keep mornings free");
  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible({ timeout: 35000 });
  const competitor = await browser.newContext({ storageState: process.env.US1_STORAGE_STATE });
  try {
    const other = await competitor.newPage();
    await other.goto(`/trips/${process.env.US2_TRIP_ID}`);
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
    await expect(page.getByRole("button", { name: "Accept proposal" })).toBeDisabled({ timeout: 20000 });
    await expect(page.getByText(/This proposal is stale/)).toBeVisible();
  } finally { await competitor.close(); }
  await requestProposal(page, "Add two nights in Kyoto and keep mornings free");
  await expect(page.getByRole("button", { name: "Accept proposal" })).toBeEnabled({ timeout: 35000 });
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await expect(async () => {
    const versions = await page.locator("[data-trip-version]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-trip-version")));
    expect(new Set(versions).size).toBe(1);
  }).toPass({ timeout: 2000 });
  // History reloads for the newly committed version; retry the whole interaction, since
  // a refetch can replace the list node between locating and clicking it.
  await expect(async () => {
    const version = await page.locator("[data-trip-version]").first().getAttribute("data-trip-version");
    await page.locator("summary", { hasText: `Version ${version}:` }).click({ timeout: 3000 });
    await page.getByRole("button", { name: "Undo latest draft change" }).click({ timeout: 3000 });
  }).toPass({ timeout: 25000 });
  await expect(page.getByText(/^Version \d+:/).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent conversation" })).toBeVisible();
});

test("@us2 @accessibility focused clarification resumes with original intent and map failure preserves the list", async ({ page }) => {
  test.skip(!process.env.US2_REFINEMENT_TRIP_ID || !process.env.US1_STORAGE_STATE, "Requires its own freshly seeded multi-destination estimate and authenticated storage state");
  test.skip(test.info().project.name !== "chromium", requiresExclusiveTrip);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/maps/countries.geojson", (route) => route.abort());
  await page.goto(`/trips/${process.env.US2_REFINEMENT_TRIP_ID}`);
  await routeMapToggle(page).click();
  await expect(page.getByRole("region", { name: "Accessible route" })).toBeVisible();
  await requestProposal(page, "Add two nights there");
  const answer = page.getByLabel("Which destination should receive the extra nights?");
  await expect(answer).toBeVisible({ timeout: 35000 });
  await answer.fill("Kyoto");
  await page.getByRole("button", { name: "Send clarification" }).click();
  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible({ timeout: 35000 });
  await page.getByRole("button", { name: "Reject proposal" }).click();
  await page.setViewportSize({ width: 400, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.getByRole("button", { name: "Finalize your trip to enable booking" })).toBeDisabled();
  await page.getByLabel("Discuss a trip change").fill("Set pace to 25");
  await page.getByLabel("Discuss a trip change").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Request a proposal" })).toBeFocused();
});
