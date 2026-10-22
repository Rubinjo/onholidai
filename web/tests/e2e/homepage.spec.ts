import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });
test("homepage explains public planning without initializing a private draft", async ({ page }) => {
  const bootstrap: string[] = [];
  page.on("request", (request) => {
    if (/planning-session|setup-drafts/.test(request.url())) bootstrap.push(request.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("banner").getByRole("link", { name: "OnHolidai home" }),
  ).toBeVisible();
  await expect(page).toHaveTitle("OnHolidai");
  await expect(page.getByRole("img", { name: "One holiday, shaped around you" })).toBeVisible();
  await expect(page.locator(".journey-globe__bubble").first()).toContainText(
    "“Look for a nice coffee stop”",
  );
  await expect(page.locator(".journey-globe__bubble").last()).toContainText(
    "“Can we add one more night?”",
  );
  await expect(page.locator(".journey-globe__bubble tspan")).toHaveCount(0);
  const contained = await page.locator(".journey-globe__bubble").evaluateAll((bubbles) =>
    bubbles.every((bubble) => {
      const box = bubble.querySelector("rect")!.getBBox();
      return Array.from(bubble.querySelectorAll("text")).every((text) => {
        const bounds = text.getBBox();
        return (
          bounds.x >= box.x &&
          bounds.x + bounds.width <= box.x + box.width &&
          bounds.y >= box.y &&
          bounds.y + bounds.height <= box.y + box.height
        );
      });
    }),
  );
  expect(contained).toBe(true);
  await expect(
    page.getByRole("heading", { name: "One holiday. All the places you want to go." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Plan your holiday", exact: true }).first(),
  ).toHaveAttribute("href", "/trips/new");
  await expect(
    page.getByText("Illustrative route. Your destinations, your pace.", { exact: true }),
  ).toBeVisible();
  expect(bootstrap).toEqual([]);
  await page.screenshot({ path: test.info().outputPath("homepage.png"), fullPage: true });
});

test("homepage distinguishes demo transport availability and explains the project", async ({
  page,
}) => {
  await page.goto("/");
  const journey = page.getByRole("region", {
    name: "A few cities. A new country. Still one holiday.",
  });
  await expect(
    journey.getByRole("img", { name: "From Lisbon to Porto to Barcelona by air" }),
  ).toBeVisible();
  await expect(journey.getByText("3 cities / 2 countries", { exact: true })).toBeVisible();
  await expect(journey.getByText("Portugal", { exact: true })).toBeVisible();
  await expect(journey.getByText("Spain", { exact: true })).toBeVisible();
  const transport = page.getByRole("list", { name: "Transport availability" });
  await expect(transport.getByRole("listitem").filter({ hasText: "Air travel" })).toContainText(
    "Supported now",
  );
  for (const mode of ["Train travel", "Car rental"]) {
    await expect(transport.getByRole("listitem").filter({ hasText: mode })).toContainText(
      "Coming soon",
    );
  }
  await expect(
    page.getByRole("link", { name: "Nebius x NVIDIA Global AI Hackathon", exact: true }),
  ).toHaveAttribute("href", "https://nebiusglobalaihackathon.devpost.com/");
  for (const name of ["Nebius", "NVIDIA"]) {
    const logo = page.getByRole("img", { name, exact: true });
    await logo.scrollIntoViewIfNeeded();
    await expect(logo).toBeVisible();
    await expect
      .poll(() => logo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  }
  await expect(page.getByText("Sandbox / demo mode", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Real possibilities. No real bookings." }),
  ).toContainText("no real bookings are made, no tickets are issued and no payments are taken");
});

test("homepage closing sections fit mobile, tablet and desktop viewports", async ({ page }) => {
  await page.goto("/");
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const journey = page.locator(".journey-range");
    await journey.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const panel = page.locator(".journey-range__panel");
    await expect(panel).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: test.info().outputPath(`homepage-${width}.png`),
      fullPage: true,
    });
  }
});
