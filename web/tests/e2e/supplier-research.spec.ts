import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120_000);

test("internal research preserves evidence and access checks without a customer supplier panel", async ({
  page,
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Supplier E2E requires a baseURL");
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
  const supplierRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /planning-offers|prebook|payments|\/bookings(?:\/|$)/i.test(new URL(request.url()).pathname)
    )
      supplierRequests.push(request.url());
  });
  async function research(componentTypes: string[]) {
    const response = await page.request.post(`/api/v1/trips/${trip.tripId}/agent-runs`, {
      headers,
      data: {
        requestId: randomUUID(),
        baseTripVersion: 1,
        purpose: "supplier_research",
        message: JSON.stringify({
          componentTypes,
          startDate: "2030-05-01",
          endDate: "2030-05-08",
          destinationIds: trip.snapshot.destinations.map(
            (destination: { id: string }) => destination.id,
          ),
        }),
      },
    });
    await expect(response).toBeOK();
    const run = await response.json();
    await expect
      .poll(
        async () => (await (await page.request.get(`/api/v1/agent-runs/${run.id}`)).json()).status,
        { timeout: 35_000 },
      )
      .toBe("completed");
    const evidence = await page.request.get(
      `/api/v1/trips/${trip.tripId}/planning-offers?version=1`,
    );
    await expect(evidence).toBeOK();
    return evidence.json();
  }

  const latest = await research(["flight", "accommodation", "activity", "rail"]);
  await page.goto(`/trips/${trip.tripId}`);
  await expect(page.getByRole("heading", { name: "Your living trip" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Compare supplier options" })).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Find supplier options|Research estimate|Research route options/,
    }),
  ).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Ask your travel assistant" })).toBeVisible();
  const history = await page.request.get(
    `/api/v1/trips/${trip.tripId}/conversations?timeline=true`,
  );
  await expect(history).toBeOK();
  expect((await history.json()).items).toEqual([]);
  expect(
    latest.offers
      .map(
        (offer: { component: { provider: string; type: string } }) =>
          `${offer.component.provider}:${offer.component.type}`,
      )
      .sort(),
  ).toEqual(["duffel:flight", "duffel:flight", "nuitee:accommodation", "viator:activity"]);
  expect(latest.outcomes).toContainEqual(
    expect.objectContaining({ componentType: "rail", status: "unsupported" }),
  );
  expect(JSON.stringify(latest)).not.toMatch(
    /supplierAmount|platformMargin|SecretRef|NUITEE_SECRET/,
  );
  const stay = latest.offers.find(
    (offer: { component: { type: string } }) => offer.component.type === "accommodation",
  );
  const details = await page.request.get(
    `/api/v1/trips/${trip.tripId}/planning-offers/${stay.offerRef}?version=1&revision=${stay.revision}`,
  );
  await expect(details).toBeOK();
  const inspected = await details.json();
  expect(inspected.offer).toMatchObject({
    offerRef: stay.offerRef,
    revision: stay.revision + 1,
  });
  const rechecked = await page.request.post(
    `/api/v1/trips/${trip.tripId}/planning-offers/${stay.offerRef}/revalidations?version=1`,
    { headers, data: { revision: inspected.offer.revision } },
  );
  await expect(rechecked).toBeOK();
  expect(await rechecked.json()).toMatchObject({
    outcome: "unsupported",
    offer: { offerRef: stay.offerRef, revision: inspected.offer.revision },
  });
  const flight = latest.offers.find(
    (offer: { component: { type: string } }) => offer.component.type === "flight",
  );
  const recheckedFlight = await page.request.post(
    `/api/v1/trips/${trip.tripId}/planning-offers/${flight.offerRef}/revalidations?version=1`,
    { headers, data: { revision: flight.revision } },
  );
  await expect(recheckedFlight).toBeOK();
  expect(await recheckedFlight.json()).toMatchObject({
    outcome: "unchanged",
    offer: { offerRef: flight.offerRef, revision: flight.revision + 1 },
  });
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

  const rail = await research(["rail"]);
  expect(rail.offers).toEqual([]);
  expect(rail.outcomes).toEqual([
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
  expect(supplierRequests).toEqual([]);
});
