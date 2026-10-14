import { expect, test } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
test("homepage explains public planning without initializing a private draft", async ({ page }) => {
  const bootstrap: string[] = [];
  page.on("request", (request) => { if (/planning-session|setup-drafts/.test(request.url())) bootstrap.push(request.url()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "One holiday. All the places you want to go." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Plan your holiday", exact: true }).first()).toHaveAttribute("href", "/trips/new");
  await expect(page.getByText("Illustrative route", { exact: true }).first()).toBeVisible();
  expect(bootstrap).toEqual([]);
});
