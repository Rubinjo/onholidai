import { expect, type Locator, type Page } from "@playwright/test";

// The builder is a client-rendered wizard: a controlled field discards typing that
// arrives before React has hydrated, so retry until the application accepts it.
export async function enterValue(field: Locator, value: string): Promise<void> {
  const section = field.locator("xpath=ancestor::details[1]");
  if (await section.count() && await section.getAttribute("open") === null) await section.locator("summary").first().click();
  if (await field.getAttribute("type") === "range") {
    await field.focus();
    const step = Number(await field.getAttribute("step") ?? 1);
    const difference = Math.round((Number(value) - Number(await field.inputValue())) / step);
    for (let index = 0; index < Math.abs(difference); index++) await field.press(difference > 0 ? "ArrowRight" : "ArrowLeft");
    await expect(field).toHaveValue(value); return;
  }
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

// Opens the public builder and waits for the opened draft. "Saved" is only rendered
// once the session and draft effects have run, which proves hydration completed.
export async function openBuilder(page: Page): Promise<void> {
  await page.goto("/trips/new");
  await expect(page.getByRole("heading", { name: "Where would you like to go?" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Saved" }).first()).toBeVisible();
}

// The public builder is a six-step wizard: destinations, origin, dates,
// travellers, preferences and review.
export async function continueStep(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Continue", exact: true }).click();
}

// Each search retries until the app accepted the query, which it signals by
// enabling the paired search control.
async function search(page: Page, field: Locator, submit: Locator, value: string): Promise<void> {
  await expect(async () => {
    await field.fill(value);
    await expect(submit).toBeEnabled({ timeout: 1000 });
  }).toPass({ timeout: 20000 });
  await submit.click();
}

export async function searchDestinations(page: Page, name: string): Promise<void> {
  await search(page, page.getByLabel("Destination search"),
    page.getByRole("button", { name: "Find destinations" }), name);
}

export async function addDestination(page: Page, name: string, countryCode: string): Promise<void> {
  await searchDestinations(page, name);
  await page.getByRole("option", { name: new RegExp(`${name}.*${countryCode}`) }).click();
}

export async function confirmOrigin(page: Page, origin = "Amsterdam", originLabel = `${origin}, NL`): Promise<void> {
  await search(page, page.getByLabel("Departure search"),
    page.getByRole("button", { name: "Find departure locations" }), origin);
  await page.getByRole("option", { name: new RegExp("^" + originLabel.replace(", ", " ") + "\\b") }).click();
}

// Walks the steps after destinations, which callers may already have arranged.
export async function finishSetup(page: Page, options: {
  origin?: string; originLabel?: string; start?: string; end?: string; title?: string;
} = {}): Promise<void> {
  await continueStep(page);
  await confirmOrigin(page, options.origin, options.originLabel);
  await continueStep(page);
  await enterValue(page.getByLabel("Start date 1"), options.start ?? "2030-05-01");
  await enterValue(page.getByLabel("End date 1"), options.end ?? "2030-05-20");
  await enterValue(page.getByLabel("Minimum days", { exact: true }), "5");
  await enterValue(page.getByLabel("Ideal days", { exact: true }), "7");
  await enterValue(page.getByLabel("Maximum days", { exact: true }), "8");
  await continueStep(page);
  await enterValue(page.getByLabel("Adults", { exact: true }), "2");
  await continueStep(page);
  await continueStep(page);
  await enterValue(page.getByLabel("Trip title", { exact: true }), options.title ?? "Tokyo holiday");
  await page.getByRole("button", { name: "Create trip and research estimate" }).click();
}

export async function completeSetup(page: Page, options: {
  destination?: string; countryCode?: string; origin?: string; originLabel?: string;
  start?: string; end?: string; title?: string;
} = {}): Promise<void> {
  await openBuilder(page);
  await addDestination(page, options.destination ?? "Tokyo", options.countryCode ?? "JP");
  await finishSetup(page, options);
}

// The route pane and the destination editor both render an optional map, so the
// workspace layout hook names which one a journey means.
export function routeMapToggle(page: Page): Locator {
  return page.locator(".trip-workspace__map").getByRole("button", { name: "Show optional route map" });
}
