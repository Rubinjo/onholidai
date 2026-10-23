import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { publicPlanningOfferSchema } from "../../server/supply/offers";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import supplyCases from "../../../contracts/supply/validation-cases.json" with { type: "json" };

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

async function createResearchTrip(page: Page, baseURL: string) {
  const headers = { origin: new URL(baseURL).origin };
  const account = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: {
      name: "Synthetic supplier researcher",
      email: `supplier-${randomUUID()}@example.invalid`,
      password: "synthetic-browser-test-password",
    },
  });
  await expect(account).toBeOK();
  const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
  snapshot.itineraryDays = [];
  const created = await page.request.post("/api/v1/trips", {
    headers,
    data: {
      requestId: randomUUID(),
      title: "Synthetic supplier research",
      currency: "GBP",
      snapshot,
    },
  });
  await expect(created).toBeOK();
  const trip = await created.json();
  const hydrated = page.waitForResponse((response) =>
    response.url().endsWith(`/api/v1/trips/${trip.tripId}/planning-offers?version=1`),
  );
  await page.goto(`/trips/${trip.tripId}`);
  await hydrated;
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  return { trip, headers };
}

test("current supplier discovery persists without trip writes, rejects stale/private access and reports rail-only unsupported", async ({
  page,
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Supplier E2E requires a baseURL");
  const { trip, headers } = await createResearchTrip(page, baseURL);
  const transactionRequests: string[] = [];
  page.on("request", (request) => {
    if (/prebook|payments|\/bookings(?:\/|$)/i.test(new URL(request.url()).pathname))
      transactionRequests.push(request.url());
  });
  const panel = page.getByRole("region", { name: "Compare supplier options", exact: true });
  await panel.getByRole("button", { name: "Find supplier options" }).click();
  await expect(panel.getByRole("button", { name: "Inspect accommodation details" })).toBeVisible({
    timeout: 35_000,
  });
  await expect(panel).toContainText(
    "Flights from Duffel; stays from Nuitee; activities from Viator",
  );
  await expect(panel.getByRole("list", { name: "Supplier options", exact: true })).toContainText(
    "nuitee",
  );
  await expect(panel.getByRole("list", { name: "Supplier search outcomes" })).toContainText(
    "rail: unsupported",
  );
  await panel.getByRole("button", { name: "Inspect accommodation details" }).click();
  await expect(panel.getByRole("region", { name: "Selected supplier evidence" })).toBeVisible({
    timeout: 20_000,
  });
  await panel.getByRole("button", { name: "Recheck accommodation availability" }).click();
  await expect(panel.getByRole("status")).toContainText("Source check: unchanged", {
    timeout: 20_000,
  });
  await expect(panel).toContainText("Demonstration only");
  const latest = await (
    await page.request.get(`/api/v1/trips/${trip.tripId}/planning-offers?version=1`)
  ).json();
  expect(
    latest.offers
      .map(
        (offer: { component: { provider: string; type: string } }) =>
          `${offer.component.provider}:${offer.component.type}`,
      )
      .sort(),
  ).toEqual(["duffel:flight", "duffel:flight", "nuitee:accommodation", "viator:activity"]);
  expect(JSON.stringify(latest)).not.toMatch(
    /supplierAmount|platformMargin|SecretRef|NUITEE_SECRET/,
  );
  expect(await (await page.request.get(`/api/v1/trips/${trip.tripId}`)).json()).toEqual(trip);
  expect(
    (
      await page.request.post(`/api/v1/trips/${trip.tripId}/agent-runs`, {
        headers,
        data: {
          requestId: randomUUID(),
          baseTripVersion: 2,
          purpose: "supplier_research",
          message: "Stale research",
        },
      })
    ).status(),
  ).toBe(409);
  const rail = await page.request.post(`/api/v1/trips/${trip.tripId}/agent-runs`, {
    headers,
    data: {
      requestId: randomUUID(),
      baseTripVersion: 1,
      purpose: "supplier_research",
      message: JSON.stringify({
        componentTypes: ["rail"],
        startDate: "2030-05-01",
        endDate: "2030-05-08",
        destinationIds: trip.snapshot.destinations.map(
          (destination: { id: string }) => destination.id,
        ),
      }),
    },
  });
  await expect(rail).toBeOK();
  const run = await rail.json();
  await expect
    .poll(
      async () => (await (await page.request.get(`/api/v1/agent-runs/${run.id}`)).json()).status,
      { timeout: 35_000 },
    )
    .toBe("completed");
  const railResult = await (
    await page.request.get(`/api/v1/trips/${trip.tripId}/planning-offers?version=1`)
  ).json();
  expect(railResult.offers).toEqual([]);
  expect(railResult.outcomes).toEqual([
    expect.objectContaining({ componentType: "rail", status: "unsupported" }),
  ]);
  const other = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    expect(
      (
        await other.request.get(`${baseURL}/api/v1/trips/${trip.tripId}/planning-offers?version=1`)
      ).status(),
    ).toBe(404);
  } finally {
    await other.close();
  }
  expect(await (await page.request.get(`/api/v1/trips/${trip.tripId}`)).json()).toEqual(trip);
  expect(transactionRequests).toEqual([]);
});

test("partial and prerequisite outcomes keep unknown multi-room facts and legacy attribution visible without checkout or fallback", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Supplier E2E requires a baseURL");
  await page.setViewportSize({ width: 320, height: 800 });
  const { trip } = await createResearchTrip(page, baseURL);
  const fixture = supplyCases.offerCases.find(
    (entry) => entry.id === "public-nuitee-multi-room-discovery",
  );
  if (!fixture) throw new Error("Shared Nuitee fixture is missing");
  const offer = publicPlanningOfferSchema.parse({
    ...fixture.value,
    offerRef: randomUUID(),
    revision: 1,
  });
  offer.component.price.finalCustomerMinor = null;
  const legacy = publicPlanningOfferSchema.parse({
    ...offer,
    offerRef: randomUUID(),
    component: { ...offer.component, provider: "duffel", supplierOfferId: "saved_duffel_stay" },
    attribution: { provider: "duffel", sourceUrl: null },
  });
  let prerequisite = "";
  await page.route("**/planning-offers?version=1", (route) =>
    route.fulfill({
      json: {
        tripVersion: 1,
        offers: [offer, legacy],
        outcomes: [
          {
            provider: "duffel",
            componentType: "flight",
            status: "error",
            safeReason: "Flights temporarily unavailable.",
          },
          {
            provider: "nuitee",
            componentType: "accommodation",
            status: prerequisite ? "access_blocked" : "available",
            safeReason: prerequisite || "Selected multi-room research.",
          },
          {
            provider: "viator",
            componentType: "activity",
            status: "no_matches",
            safeReason: "No matching activities.",
          },
        ],
      },
    }),
  );
  await page.route("**/planning-offers/*/revalidations?version=1", (route) => {
    const selected = route.request().url().includes(legacy.offerRef!) ? legacy : offer;
    return route.fulfill({ json: { outcome: "unsupported", offer: selected, differences: [] } });
  });
  await page.reload();
  const panel = page.getByRole("region", { name: "Compare supplier options", exact: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(panel).toContainText("Flights temporarily unavailable.");
  await expect(panel).toContainText("Customer total: Unknown");
  await expect(panel).toContainText("Start time unknown");
  await panel.getByRole("button", { name: "Recheck accommodation availability" }).last().click();
  await expect(panel.getByRole("status")).toContainText("Source check: unsupported");
  await expect(panel.getByRole("list", { name: "Supplier options", exact: true })).toContainText(
    "duffel",
  );
  for (const missing of [
    "Trusted nationality is required.",
    "Trusted room occupancy and child ages are required.",
  ]) {
    prerequisite = missing;
    await page.reload();
    await expect(panel).toContainText(missing);
    await expect(panel.getByRole("list", { name: "Supplier options", exact: true })).toContainText(
      "nuitee",
    );
  }
  await expect(panel.getByRole("button", { name: /book|reserve|accept/i })).toHaveCount(0);
  expect(await (await page.request.get(`/api/v1/trips/${trip.tripId}`)).json()).toEqual(trip);
});
