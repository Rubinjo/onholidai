import { expect, test } from "@playwright/test";

test("@us2 @accessibility review, conflict, history and undo keep the committed panes coherent", async ({ page, browser }) => {
  test.skip(!process.env.US2_TRIP_ID || !process.env.US1_STORAGE_STATE, "Requires a seeded accepted synthetic estimate and authenticated storage state");
  await page.goto(`/trips/${process.env.US2_TRIP_ID}`);
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Booking unavailable" })).toBeDisabled();
  await page.getByLabel("Discuss a trip change").fill("Add two nights in Kyoto and keep mornings free");
  await page.getByRole("button", { name: "Request a proposal" }).click();
  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible({ timeout: 35000 });
  const competitor = await browser.newContext({ storageState: process.env.US1_STORAGE_STATE });
  try {
    const other = await competitor.newPage();
    await other.goto(`/trips/${process.env.US2_TRIP_ID}`);
    const adults = Number(await other.getByLabel("Adults", { exact: true }).inputValue());
    await other.getByLabel("Adults", { exact: true }).fill(String(adults < 9 ? adults + 1 : adults - 1));
    await other.getByRole("button", { name: "Review edit impacts" }).click();
    await expect(other.getByRole("button", { name: "Accept reviewed edit" })).toBeVisible();
    await other.getByRole("button", { name: "Accept reviewed edit" }).click();
    await expect(page.getByRole("button", { name: "Accept proposal" })).toBeDisabled({ timeout: 2000 });
    await expect(page.getByText(/This proposal is stale/)).toBeVisible();
  } finally { await competitor.close(); }
  await page.getByLabel("Discuss a trip change").fill("Add two nights in Kyoto and keep mornings free");
  await page.getByRole("button", { name: "Request a proposal" }).click();
  await expect(page.getByRole("button", { name: "Accept proposal" })).toBeEnabled({ timeout: 35000 });
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await expect(async () => {
    const versions = await page.locator("[data-trip-version]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-trip-version")));
    expect(new Set(versions).size).toBe(1);
  }).toPass({ timeout: 2000 });
  await page.getByText(/^Version \d+:/).first().click();
  await page.getByRole("button", { name: "Undo latest draft change" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Agent conversation" })).toBeVisible();
});

test("@us2 @accessibility focused clarification resumes with original intent and map failure preserves the list", async ({ page }) => {
  test.skip(!process.env.US2_TRIP_ID || !process.env.US1_STORAGE_STATE, "Requires a seeded multi-destination estimate and authenticated storage state");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/maps/countries.geojson", (route) => route.abort());
  await page.goto(`/trips/${process.env.US2_TRIP_ID}`);
  await page.getByRole("button", { name: "Show optional route map" }).click();
  await expect(page.getByRole("region", { name: "Accessible route" })).toBeVisible();
  await page.getByLabel("Discuss a trip change").fill("Add two nights there");
  await page.getByRole("button", { name: "Request a proposal" }).click();
  const answer = page.getByLabel("Which destination should receive the extra nights?");
  await expect(answer).toBeVisible({ timeout: 35000 });
  await answer.fill("Kyoto");
  await page.getByRole("button", { name: "Send clarification" }).click();
  await expect(page.getByRole("heading", { name: "Review proposed changes" })).toBeVisible({ timeout: 35000 });
  await page.getByRole("button", { name: "Reject proposal" }).click();
  await page.setViewportSize({ width: 400, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(page.getByRole("button", { name: "Booking unavailable" })).toBeDisabled();
  await page.getByLabel("Discuss a trip change").fill("Set pace to 25");
  await page.getByLabel("Discuss a trip change").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Request a proposal" })).toBeFocused();
});
