import { expect, test } from "@playwright/test";
import { completeSetup } from "../helpers/setup-wizard";
test.use({ storageState: { cookies: [], origins: [] } });
test("free registration asks for identity only and offers an existing-account path", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in instead" })).toHaveAttribute("href", /sign-in/);
  await expect(page.locator('input[name*="payment"],input[name*="card"]')).toHaveCount(0);
});

test("guest finalization continues through free sign-up and explicit same-trip linking without booking consent", async ({ page }) => {
  test.setTimeout(120000);
  await completeSetup(page, { title: "Same-trip account continuation" });
  await expect(page.getByRole("button", { name: "Accept proposal" })).toBeEnabled({ timeout: 35000 }); await page.getByRole("button", { name: "Accept proposal" }).click();
  await expect(page.getByText(/Committed version 2/)).toBeVisible();
  await page.getByRole("button", { name: "Prepare detailed itinerary" }).click();
  await expect(page.getByRole("button", { name: "Accept proposal" })).toBeEnabled({ timeout: 35000 }); await page.getByRole("button", { name: "Accept proposal" }).click();
  await expect(page.getByText(/Committed version 3/)).toBeVisible();
  await page.getByRole("button", { name: "Review finalization" }).click();
  await expect(page.getByText("No known blocking conflicts.")).toBeVisible();
  await page.getByLabel("I have reviewed the unverified conditions and planning exceptions").check();
  await page.getByRole("button", { name: "Finalize planning itinerary" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Planning itinerary finalized" })).toBeVisible();
  const tripId = new URL(page.url()).pathname.split("/")[2], before = await (await page.request.get(`/api/v1/trips/${tripId}`)).json();
  await page.getByRole("link", { name: "Review live booking terms" }).click();
  await expect(page.getByRole("heading", { name: "Keep this trip when you enter booking" })).toBeVisible();
  await page.getByRole("button", { name: "Create a free account" }).click();
  await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
  const email = `${crypto.randomUUID()}@example.invalid`, password = "Synthetic-browser-password-42!";
  await page.getByLabel("Name", { exact: false }).fill("Synthetic traveller"); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create free account" }).click();
  await expect(page.getByRole("heading", { name: "Continue with your saved trip" })).toBeVisible();
  await page.getByRole("button", { name: "Link this trip and continue" }).click();
  await expect(page.getByRole("heading", { name: "Your trip is linked to your account" })).toBeVisible();
  const after = await (await page.request.get(`/api/v1/trips/${tripId}`)).json();
  expect(after.version).toBe(before.version); expect(after.snapshot).toEqual(before.snapshot);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByText("You can plan your visit without creating an account.", { exact: false })).toHaveCount(0);
  // Signing out removes account authority; the old guest cookie cannot recover a linked trip.
  const origin = new URL(page.url()).origin;
  expect((await page.request.post("/api/auth/sign-out", { headers: { origin }, data: {} })).ok()).toBe(true);
  await page.reload(); await expect(page.getByRole("heading", { name: "Private plan unavailable" })).toBeVisible();
  await page.goto(`/sign-in?redirectTo=${encodeURIComponent(`/trips/${tripId}`)}`);
  await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  expect((await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).snapshot).toEqual(before.snapshot);
});
