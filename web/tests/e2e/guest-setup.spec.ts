import { expect, test } from "@playwright/test";
import { addDestination, confirmOrigin, continueStep, enterValue, finishSetup, openBuilder, searchDestinations, selectAvailability } from "../helpers/setup-wizard";
test.use({ storageState: { cookies: [], origins: [] } });
test("guest setup is public and acknowledged destination changes survive refresh", async ({ page }) => {
  await page.goto("/trips/new");
  await expect(page.getByRole("heading", { name: "Where would you like to go?" })).toBeVisible();
  // Wait for the opened draft before typing. "Saved" here is the app's own ready
  // signal: it is only set once the session and draft effects have run, so typing
  // earlier cannot be reverted by the controlled input hydrating afterwards.
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  await page.getByLabel("Destination search").fill("Tokyo");
  await page.getByLabel("Destination search").press("Enter");
  // Wait for the committed save acknowledgement; "Saved" alone also describes the
  // freshly opened draft, so reloading on it races the debounced write.
  const acknowledged = page.waitForResponse((response) => response.request().method() === "PATCH"
    && /\/api\/v1\/setup-drafts\//.test(response.url()) && response.ok());
  await page.getByRole("option", { name: /Tokyo/ }).click();
  await acknowledged;
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("list", { name: "Selected destinations" })).toContainText("Tokyo");
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Where are you starting?" })).toBeFocused();
  await expect(page).not.toHaveURL(/sign-in/);
});
test("search and list remain available when the globe fails", async ({ page }) => {
  await page.route("**/maps/countries.geojson", (route) => route.abort());
  await page.goto("/trips/new");
  await expect(page.getByLabel("Destination search")).toBeVisible();
  await page.getByLabel("Destination search").focus();
  await expect(page.getByLabel("Destination search")).toBeFocused();
});

test("the builder blocks an invalid step and reports the field to correct", async ({ page }) => {
  await openBuilder(page);
  await continueStep(page);
  await expect(page.getByRole("alert").filter({ hasText: "Add at least one destination." })).toBeVisible();
  await expect(page.getByLabel("Destination search")).toHaveAttribute("aria-invalid", "true");

  await addDestination(page, "Tokyo", "JP");
  await continueStep(page);
  await confirmOrigin(page);
  await continueStep(page);
  await continueStep(page);
  // Required date and duration controls report through native validation, which the
  // form surfaces once, and the offending fields are marked.
  await expect(page.getByRole("alert").filter({ hasText: "Enter ordered start and end dates for every window." })).toBeVisible();
  await expect(page.locator('[data-setup-field="availabilityWindows"]')).toHaveAttribute("aria-invalid", "true");

  await selectAvailability(page, "2030-05-01", "2030-05-20");
  await enterValue(page.getByLabel("Minimum days", { exact: true }), "5");
  await enterValue(page.getByLabel("Ideal days", { exact: true }), "7");
  await enterValue(page.getByLabel("Maximum days", { exact: true }), "8");
  await continueStep(page);
  await expect(page.getByRole("heading", { name: "Who is coming along?" })).toBeFocused();
  await page.getByRole("button", { name: "Add child" }).click();
  await continueStep(page);
  await expect(page.getByRole("alert").filter({ hasText: "Check the highlighted field before continuing." })).toBeVisible();
  await expect(page.getByLabel("Child 1 age at trip start")).toHaveAttribute("aria-invalid", "true");
});

test("reordered, replaced and removed destinations persist through an automatic guest estimate", async ({ page }) => {
  test.setTimeout(120_000);
  await openBuilder(page);
  await addDestination(page, "Japan", "JP");
  await addDestination(page, "Tokyo", "JP");
  await addDestination(page, "Kyoto", "JP");
  await page.getByRole("button", { name: "Move Kyoto earlier" }).click();
  await page.getByRole("button", { name: "Replace Tokyo" }).click();
  await searchDestinations(page, "Seoul");
  await page.getByRole("option", { name: /Seoul.*KR/ }).click();
  await addDestination(page, "Amsterdam", "NL");
  await page.getByRole("button", { name: "Remove Amsterdam" }).click();
  const selected = page.getByRole("list", { name: "Selected destinations" });
  await expect(selected.getByRole("listitem")).toHaveCount(2);
  expect(await selected.innerText()).toMatch(/Kyoto[\s\S]*Seoul/);

  const acknowledged = page.waitForResponse((response) => response.request().method() === "PATCH"
    && /\/api\/v1\/setup-drafts\//.test(response.url()) && response.ok());
  await continueStep(page);
  await acknowledged;
  await finishSetup(page);
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await expect(page.getByText(/Committed version 2/)).toBeVisible({ timeout: 35000 });
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible({ timeout: 35000 });
  const url = page.url();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(page.getByRole("link", { name: "Book trip" })).toBeVisible();
});
