import { expect, test } from "@playwright/test";

import { completeSetup, savedVersion } from "../helpers/setup-wizard";

test.use({ storageState: { cookies: [], origins: [] } });
test("free registration asks for identity only and offers an existing-account path", async ({
  page,
}) => {
  await page.goto("/sign-up");
  await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in instead" })).toHaveAttribute(
    "href",
    /sign-in/,
  );
  await expect(page.locator('input[name*="payment"],input[name*="card"]')).toHaveCount(0);
});

test("Book trip continues from a draft through free sign-up and same-trip linking without booking consent", async ({
  page,
}) => {
  test.setTimeout(120000);
  await completeSetup(page, { title: "Same-trip account continuation" });
  await expect(savedVersion(page, 2)).toBeVisible({ timeout: 35000 });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: "Home", exact: true })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(navigation.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    `/sign-in?redirectTo=${encodeURIComponent(new URL(page.url()).pathname)}`,
  );
  await expect(page.getByRole("heading", { name: "Finalization review" })).toHaveCount(0);
  const tripId = new URL(page.url()).pathname.split("/")[2],
    before = await (await page.request.get(`/api/v1/trips/${tripId}`)).json();
  await page.getByRole("link", { name: "Book trip" }).click();
  await expect(
    page.getByRole("heading", { name: "Keep this trip when you enter booking" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create a free account" }).click();
  await expect(page.getByRole("heading", { name: "Create your free account" })).toBeVisible();
  const email = `${crypto.randomUUID()}@example.invalid`,
    password = "Synthetic-browser-password-42!";
  await page.getByLabel("Name", { exact: false }).fill("Synthetic traveller");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create free account" }).click();
  await expect(page.getByRole("heading", { name: "Continue with your saved trip" })).toBeVisible();
  await page.getByRole("button", { name: "Link this trip and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Your trip is linked to your account" }),
  ).toBeVisible();
  const after = await (await page.request.get(`/api/v1/trips/${tripId}`)).json();
  expect(after.version).toBe(before.version);
  expect(after.snapshot).toEqual(before.snapshot);
  await page.goto(`/trips/${tripId}/booking`);
  await expect(page.getByRole("heading", { name: "Review booking" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your whole trip" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Authorize and start whole-trip booking" }),
  ).toHaveCount(0);
  expect((await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).version).toBe(
    before.version,
  );
  await page.goto(`/trips/${tripId}`);
  await expect(
    page.getByText("You can plan your visit without creating an account.", { exact: false }),
  ).toHaveCount(0);
  // Signing out removes account authority; the old guest cookie cannot recover a linked trip.
  await navigation.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { name: "Private plan unavailable" })).toBeVisible();
  await navigation.getByRole("link", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  expect((await (await page.request.get(`/api/v1/trips/${tripId}`)).json()).snapshot).toEqual(
    before.snapshot,
  );
});
