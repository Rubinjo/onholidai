// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { createDuffelFlightsHttpClient } from "../../server/supply/providers/duffel-http";
import { createDuffelReadProvider } from "../../server/supply/providers/duffel-read";
import { createConfiguredPlanningProviders } from "../../server/supply/providers";
import { loadServerConfig } from "../../server/config";
import { normalizePlanningOffer, projectPublicPlanningOffer } from "../../server/supply/offers";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

import type { SupplyReadQuery } from "../../server/supply/read";

vi.mock("server-only", () => ({}));
const now = () => new Date("2030-01-01T00:00:00Z");
function query(): SupplyReadQuery {
  const trip = createSyntheticTripSnapshot();
  return {
    componentTypes: ["flight"],
    currency: "GBP",
    departureOrigin: { ...trip.departureOrigin, airportCode: "LHR" },
    destinationIds: [trip.destinations[0].id],
    startDate: "2030-05-01",
    endDate: "2030-05-08",
    travellerParty: { adults: 2, children: [] },
  };
}
function offer() {
  return {
    id: "off_synthetic1",
    base_currency: "GBP",
    total_currency: "GBP",
    tax_currency: "GBP",
    base_amount: "100.10",
    tax_amount: "20.20",
    total_amount: "120.30",
    expires_at: "2030-01-01T00:15:00Z",
    slices: [
      {
        segments: [
          {
            departing_at: "2030-05-01T10:00:00",
            arriving_at: "2030-05-01T14:00:00",
            origin: { iata_code: "LHR" },
            destination: { iata_code: "JFK" },
          },
        ],
      },
    ],
    conditions: { refund_before_departure: { allowed: false } },
    client_key: "synthetic-private-marker",
  };
}
function setup(payload: unknown = { data: { offers: [offer()] } }) {
  const offers = (payload as { data?: { offers?: unknown[] } }).data?.offers ?? [];
  const transport = vi.fn<typeof fetch>(async (url) => {
    const href = String(url);
    if (href.includes("/offer_requests?")) return Response.json({ data: { id: "orq_synthetic1" } });
    if (href.includes("/offers?offer_request_id=")) return Response.json({ data: offers });
    return Response.json({ data: offers[0] });
  });
  const client = createDuffelFlightsHttpClient({
    readToken: "synthetic-read-key",
    fetch: transport,
    now,
    resolveDestination: () => "JFK",
  });
  return { client, transport };
}
function paged(offers: unknown[]) {
  return vi.fn<typeof fetch>(async (url) => {
    const href = String(url);
    if (href.includes("/offer_requests?")) return Response.json({ data: { id: "orq_synthetic1" } });
    if (href.includes("/offers?offer_request_id=")) return Response.json({ data: offers });
    return Response.json({ data: offers[0] });
  });
}
describe("Duffel Flights synthetic HTTP wire", () => {
  it("uses the origin's local day and retries an earlier return when arrival exceeds availability", async () => {
    let returnDate = "";
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      if (String(url).includes("/offer_requests?")) {
        returnDate = JSON.parse(String(init?.body)).data.slices[1].departure_date;
        return Response.json({ data: { id: "orq_dates" } });
      }
      const source = offer();
      source.slices[0].segments[0].departing_at = "2030-04-30T23:00:00Z";
      source.slices[0].segments[0].arriving_at =
        returnDate === "2030-05-08" ? "2030-05-09T01:00:00Z" : "2030-05-08T01:00:00Z";
      return Response.json({ data: [source] });
    });
    const client = createDuffelFlightsHttpClient({
      readToken: "synthetic",
      fetch: transport,
      now,
      resolveDestination: () => "HND",
    });
    const hits = await client.search(query(), new AbortController().signal);
    expect(hits).toHaveLength(1);
    expect(hits[0].serviceStart).toBe("2030-04-30T23:00:00.000Z");
    expect(hits[0].serviceEnd).toBe("2030-05-08T01:00:00.000Z");
    expect(
      transport.mock.calls
        .filter(([url]) => String(url).includes("/offer_requests?"))
        .map(([, init]) => JSON.parse(String(init?.body)).data.slices[1].departure_date),
    ).toEqual(["2030-05-08", "2030-05-07"]);
  });

  it("compares round-trip and open-jaw fares as alternatives, never as additive flight legs", async () => {
    const first = "10000000-0000-4000-8000-000000000003";
    const last = "10000000-0000-4000-8000-000000000099";
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      const href = String(url);
      if (href.includes("/offer_requests?")) {
        const body = JSON.parse(String(init?.body)) as { data: { slices: { origin: string }[] } };
        return Response.json({ data: { id: `orq_${body.data.slices[1].origin}` } });
      }
      const id = href.includes("orq_ITM") ? "off_openjaw" : "off_roundtrip";
      return Response.json({ data: [{ ...offer(), id }] });
    });
    const provider = createDuffelReadProvider(
      createDuffelFlightsHttpClient({
        readToken: "synthetic",
        fetch: transport,
        now,
        resolveDestination: (id) => (id === first ? "HND" : "ITM"),
      }),
    );
    const offers = await provider.search(
      { ...query(), destinationIds: [first, last] },
      new AbortController().signal,
    );
    const searches = transport.mock.calls.filter(([url]) =>
      String(url).includes("/offer_requests?"),
    );
    expect(searches.map(([, init]) => JSON.parse(String(init?.body)).data.slices)).toEqual([
      [
        { origin: "LHR", destination: "HND", departure_date: "2030-05-01" },
        { origin: "HND", destination: "LHR", departure_date: "2030-05-08" },
      ],
      [
        { origin: "LHR", destination: "HND", departure_date: "2030-05-01" },
        { origin: "ITM", destination: "LHR", departure_date: "2030-05-08" },
      ],
    ]);
    expect(offers).toHaveLength(2);
    expect(new Set(offers.map((entry) => normalizePlanningOffer(entry).selectionGroup)).size).toBe(
      1,
    );
  });

  it("maps each slice to its own journey so a round trip is never one long flight", async () => {
    const source = {
      ...offer(),
      slices: [
        {
          segments: [
            {
              departing_at: "2030-04-30T23:00:00Z",
              arriving_at: "2030-05-01T08:30:00Z",
              origin: { iata_code: "LHR", time_zone: "Europe/London" },
              destination: { iata_code: "HND", time_zone: "Asia/Tokyo" },
              marketing_carrier: { name: "Example Air" },
            },
          ],
        },
        {
          segments: [
            {
              departing_at: "2030-05-08T00:00:00Z",
              arriving_at: "2030-05-08T08:30:00Z",
              origin: { iata_code: "HND", time_zone: "Asia/Tokyo" },
              destination: { iata_code: "LHR", time_zone: "Europe/London" },
              marketing_carrier: { name: "Example Air" },
            },
          ],
        },
      ],
    };
    const { client } = setup({ data: { offers: [source] } });
    const [hit] = await client.search(query(), new AbortController().signal);
    expect(hit.serviceStart).toBe("2030-04-30T23:00:00.000Z");
    expect(hit.serviceEnd).toBe("2030-05-08T08:30:00.000Z");
    expect(hit.details).toBeNull();
    expect(hit.planningDetails).toMatchObject({
      flightDirection: "return",
      // The fare's whole-trip window is not a flight duration.
      durationMinutes: null,
      airportNames: ["LHR", "HND"],
      airlines: ["Example Air"],
      flightJourneys: [
        {
          direction: "outbound",
          origin: "LHR",
          destination: "HND",
          originTimezone: "Europe/London",
          destinationTimezone: "Asia/Tokyo",
          departingAt: "2030-04-30T23:00:00.000Z",
          arrivingAt: "2030-05-01T08:30:00.000Z",
          legs: ["LHR → HND"],
        },
        {
          direction: "return",
          origin: "HND",
          destination: "LHR",
          originTimezone: "Asia/Tokyo",
          destinationTimezone: "Europe/London",
          departingAt: "2030-05-08T00:00:00.000Z",
          arrivingAt: "2030-05-08T08:30:00.000Z",
          legs: ["HND → LHR"],
        },
      ],
    });
    expect(Object.keys(JSON.parse(hit.planningDetails!.fareConditions!))).not.toContain(
      "flightJourneys",
    );
  });

  it("uses an explicitly reassigned discovery-only token for EUR offers without creating worker authority", async () => {
    const environment = {
      PROVIDER_MODE: "live",
      BOOKING_DEMO_ENABLED: "true",
      DUFFEL_READ_SECRET: "duffel_test_synthetic_unused",
      DUFFEL_TRANSACTION_SECRET: "duffel_test_synthetic_discovery_only",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: { readSecretRef: "DUFFEL_TRANSACTION_SECRET" },
      }),
    };
    const source = {
      ...offer(),
      base_currency: "EUR",
      tax_currency: "EUR",
      total_currency: "EUR",
    };
    const transport = paged([source]);
    const [provider] = createConfiguredPlanningProviders(
      loadServerConfig(environment),
      environment,
      { fetch: transport, flightDestination: () => "JFK" },
    );
    const signal = new AbortController().signal;
    const input = { ...query(), currency: "EUR" };
    const offers = await provider.search(input, signal);
    const selected = projectPublicPlanningOffer(
      await provider.detail!("off_synthetic1", input, signal),
      now(),
    );
    expect(offers).toHaveLength(1);
    expect(selected.component.supplierOfferId).toBe(
      projectPublicPlanningOffer(offers[0], now()).component.supplierOfferId,
    );
    expect(selected.component.price).toMatchObject({
      currency: "EUR",
      finalCustomerMinor: 12030,
      // The payable total is Duffel's offer total; the fee breakdown stays unverified.
      feesMinor: null,
    });
    for (const [, init] of transport.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${environment.DUFFEL_TRANSACTION_SECRET}`,
      );
      expect(JSON.stringify(init)).not.toContain(environment.DUFFEL_READ_SECRET);
    }
    expect(transport.mock.calls.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
      "POST https://api.duffel.com/air/offer_requests?return_offers=false",
      "GET https://api.duffel.com/air/offers?offer_request_id=orq_synthetic1&limit=32&sort=total_amount",
      "GET https://api.duffel.com/air/offers/off_synthetic1",
    ]);
    expect(JSON.stringify(selected)).not.toMatch(
      /synthetic_discovery_only|synthetic_unused|client_key|SecretRef/,
    );
    expect(Object.keys(provider).sort()).toEqual([
      "capabilities",
      "detail",
      "revalidate",
      "search",
    ]);
  });

  it.each(["base_currency", "tax_currency", "total_currency"])(
    "does not relabel an incompatible %s or grant its offer for detail",
    async (field) => {
      const source = {
        ...offer(),
        base_currency: "EUR",
        tax_currency: "EUR",
        total_currency: "EUR",
        [field]: "GBP",
      };
      const { client, transport } = setup({ data: { offers: [source] } });
      const input = { ...query(), currency: "EUR" };
      const signal = new AbortController().signal;
      await expect(client.search(input, signal)).rejects.toMatchObject({
        status: "unsupported",
      });
      await expect(client.detail(source.id, input, signal)).rejects.toMatchObject({
        status: "unsupported",
      });
      expect(transport).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects EUR shopping results for a GBP trip without inferring an exchange rate", async () => {
    const source = {
      ...offer(),
      base_currency: "EUR",
      tax_currency: "EUR",
      total_currency: "EUR",
    };
    const { client, transport } = setup({ data: { offers: [source] } });
    await expect(client.search(query(), new AbortController().signal)).rejects.toMatchObject({
      status: "unsupported",
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each(["detail", "revalidate"] as const)(
    "rejects a changed selected-offer currency during %s without conversion or a replacement offer",
    async (operation) => {
      const { client, transport } = setup();
      const signal = new AbortController().signal;
      await client.search(query(), signal);
      transport.mockImplementation(async () =>
        Response.json({
          data: {
            ...offer(),
            base_currency: "EUR",
            tax_currency: "EUR",
            total_currency: "EUR",
          },
        }),
      );
      await expect(client[operation]("off_synthetic1", query(), signal)).rejects.toMatchObject({
        status: "unsupported",
      });
      expect(transport).toHaveBeenCalledTimes(3);
    },
  );

  it("uses only the dedicated discovery token for configured search and granted offer reads", async () => {
    const environment = {
      PROVIDER_MODE: "live",
      DUFFEL_READ_SECRET: "duffel_test_synthetic_discovery_rw",
      DUFFEL_TRANSACTION_SECRET: "duffel_test_synthetic_worker_rw",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: {
          readSecretRef: "DUFFEL_READ_SECRET",
          transactionSecretRef: "DUFFEL_TRANSACTION_SECRET",
        },
      }),
    };
    const transport = paged([offer()]);
    const [provider] = createConfiguredPlanningProviders(
      loadServerConfig(environment),
      environment,
      { fetch: transport, flightDestination: () => "JFK" },
    );
    const signal = new AbortController().signal;
    await provider.search(query(), signal);
    await provider.detail!("off_synthetic1", query(), signal);
    await provider.revalidate!("off_synthetic1", query(), signal);
    expect(transport.mock.calls.map(([url, init]) => `${init?.method} ${url}`)).toEqual([
      "POST https://api.duffel.com/air/offer_requests?return_offers=false",
      "GET https://api.duffel.com/air/offers?offer_request_id=orq_synthetic1&limit=32&sort=total_amount",
      "GET https://api.duffel.com/air/offers/off_synthetic1",
      "GET https://api.duffel.com/air/offers/off_synthetic1",
    ]);
    for (const [, init] of transport.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${environment.DUFFEL_READ_SECRET}`,
      );
      expect(JSON.stringify(init)).not.toContain(environment.DUFFEL_TRANSACTION_SECRET);
    }
    for (const operation of ["execute", "book", "getStatus", "cancel", "reschedule"])
      expect(provider).not.toHaveProperty(operation);
  });

  it("does not compose a discovery client from a worker-only Duffel token", () => {
    const environment = {
      PROVIDER_MODE: "live",
      DUFFEL_TRANSACTION_SECRET: "duffel_test_synthetic_worker_rw",
      SUPPLIER_PROVIDERS: JSON.stringify({
        duffel: { transactionSecretRef: "DUFFEL_TRANSACTION_SECRET" },
      }),
    };
    const transport = vi.fn<typeof fetch>();
    expect(
      createConfiguredPlanningProviders(loadServerConfig(environment), environment, {
        fetch: transport,
        flightDestination: () => "JFK",
      }),
    ).toEqual([]);
    expect(transport).not.toHaveBeenCalled();
  });

  it("reports insufficient search permissions without retrying or falling back to a booking key", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          errors: [
            {
              code: "insufficient_permissions",
              type: "authentication_error",
              message: "private-supplier-permission-canary",
            },
          ],
        },
        { status: 403 },
      ),
    );
    const client = createDuffelFlightsHttpClient({
      readToken: "duffel_test_synthetic_dedicated_discovery",
      fetch: transport,
      resolveDestination: () => "JFK",
    });
    const failure = client.search(query(), new AbortController().signal);
    await expect(failure).rejects.toMatchObject({ status: "access_blocked" });
    await expect(failure).rejects.not.toThrow("private-supplier-permission-canary");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe(
      "https://api.duffel.com/air/offer_requests?return_offers=false",
    );
  });

  it("constructs only documented round-trip search fields and exact minor amounts", async () => {
    const { client, transport } = setup();
    const hits = await client.search(query(), new AbortController().signal);
    expect(hits[0]).toMatchObject({
      offerId: "off_synthetic1",
      supplierMinor: 10010,
      taxesMinor: 2020,
      feesMinor: null,
      checkedAt: now().toISOString(),
      expiresAt: "2030-01-01T00:15:00.000Z",
      serviceStart: null,
      serviceEnd: null,
      terms: expect.stringContaining("are not established by this read"),
    });
    expect(JSON.stringify(hits)).not.toContain("synthetic-private-marker");
    const call = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.duffel.com/air/offer_requests?return_offers=false");
    expect(call[1]).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      headers: { Authorization: "Bearer synthetic-read-key", "Duffel-Version": "v2" },
    });
    expect(JSON.parse(call[1].body as string)).toEqual({
      data: {
        slices: [
          { origin: "LHR", destination: "JFK", departure_date: "2030-05-01" },
          { origin: "JFK", destination: "LHR", departure_date: "2030-05-08" },
        ],
        passengers: [{ type: "adult" }, { type: "adult" }],
      },
    });
  });
  it("maps into the existing adapter without fabricating local timestamps", async () => {
    const { client } = setup();
    const hits = await createDuffelReadProvider(client).search(
      query(),
      new AbortController().signal,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ component: { serviceStart: null, serviceEnd: null } });
  });
  it("preserves sourced fare/baggage and payment prerequisites without assuming zero additional fees", async () => {
    const payload = {
      ...offer(),
      passenger_identity_documents_required: true,
      payment_requirements: {
        requires_instant_payment: false,
        payment_required_by: "2030-01-01T00:10:00Z",
        price_guarantee_expires_at: "2030-01-01T00:08:00Z",
      },
      available_services: [{ id: "ase_synthetic1", total_amount: "private-service-price" }],
      slices: [
        {
          fare_brand_name: "Synthetic Economy",
          segments: [
            {
              departing_at: "2030-05-01T10:00:00",
              arriving_at: "2030-05-01T14:00:00",
              origin: { iata_code: "LHR" },
              destination: { iata_code: "JFK" },
              passengers: [
                {
                  passenger_id: "private-passenger-reference",
                  cabin_class: "economy",
                  fare_basis_code: "SYNTHETIC",
                  baggages: [
                    { type: "checked", quantity: 1 },
                    { type: "carry_on", quantity: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const { client } = setup({ data: { offers: [payload] } });
    const hit = (await client.search(query(), new AbortController().signal))[0];
    expect(hit.feesMinor).toBeNull();
    const facts = JSON.parse(hit.planningDetails.fareConditions!);
    expect(facts).toMatchObject({
      fareBrands: ["Synthetic Economy"],
      route: [{ origin: "LHR", destination: "JFK", airports: ["LHR", "JFK"] }],
      additionalServicesAvailable: true,
      extraCostsVerified: false,
      identityDocumentsRequired: true,
      paymentRequirements: {
        requiresInstantPayment: false,
        paymentRequiredBy: "2030-01-01T00:10:00.000Z",
        priceGuaranteeExpiresAt: "2030-01-01T00:08:00.000Z",
      },
      passengerFares: [
        {
          segmentIndex: 0,
          passengerIndex: 0,
          cabinClass: "economy",
          fareBasisCode: "SYNTHETIC",
          baggage: [
            { type: "checked", quantity: 1 },
            { type: "carry_on", quantity: 0 },
          ],
        },
      ],
    });
    expect(JSON.stringify(hit)).not.toMatch(/private-|client_key|passenger_id/);
  });
  it("qualifies local times only with the source airport timezone and leaves ambiguous times unknown", async () => {
    const source = offer();
    const segment = source.slices[0].segments[0];
    const payload = {
      ...source,
      slices: [
        {
          segments: [
            {
              ...segment,
              origin: { ...segment.origin, time_zone: "Europe/London" },
              destination: { ...segment.destination, time_zone: "America/New_York" },
            },
          ],
        },
      ],
    };
    const { client, transport } = setup({ data: { offers: [payload] } });
    const signal = new AbortController().signal;
    const hit = (await client.search(query(), signal))[0];
    expect(hit.serviceStart).toBe("2030-05-01T09:00:00.000Z");
    expect(hit.serviceEnd).toBe("2030-05-01T18:00:00.000Z");
    const changed = {
      ...payload,
      base_amount: "110.10",
      total_amount: "130.30",
      slices: [
        { segments: [{ ...payload.slices[0].segments[0], departing_at: "2030-10-27T01:30:00" }] },
      ],
    };
    transport.mockImplementation(async () => new Response(JSON.stringify({ data: changed })));
    const current = await client.revalidate("off_synthetic1", query(), signal);
    expect(current.supplierMinor).toBe(11010);
    expect(current.serviceStart).toBeNull();
    expect(current.expiresAt).toBe(hit.expiresAt);
  });
  it("retrieves and revalidates only previously searched, same-query offers", async () => {
    const { client, transport } = setup();
    const signal = new AbortController().signal;
    await expect(client.detail("off_ungranted", query(), signal)).rejects.toMatchObject({
      status: "unsupported",
    });
    await client.search(query(), signal);
    transport.mockImplementation(async () => new Response(JSON.stringify({ data: offer() })));
    await expect(client.detail("off_synthetic1", query(), signal)).resolves.toMatchObject({
      supplierMinor: 10010,
    });
    await expect(
      client.revalidate("off_synthetic1", { ...query(), endDate: "2030-05-09" }, signal),
    ).rejects.toMatchObject({ status: "unsupported" });
    const call = transport.mock.calls[2] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.duffel.com/air/offers/off_synthetic1");
    expect(call[1].method).toBe("GET");
    expect(Object.keys(client).sort()).toEqual(["detail", "revalidate", "search"]);
    await expect(client.detail("../orders", query(), signal)).rejects.toMatchObject({
      status: "unsupported",
    });
    expect(transport).toHaveBeenCalledTimes(3);
  });
  it.each([
    { total_amount: "120.31" },
    { tax_amount: "-2.00" },
    { total_currency: "USD" },
    { total_amount: "9007199254740992.00" },
    { slices: "invalid" },
  ])("fails safely for inconsistent/malformed price or route evidence %j", async (change) => {
    const { client } = setup({ data: { offers: [{ ...offer(), ...change }] } });
    await expect(client.search(query(), new AbortController().signal)).rejects.toHaveProperty(
      "name",
      "SupplyReadError",
    );
  });
  it("does not forward unresolved destinations, extra query fields or missing origins", async () => {
    const { client, transport } = setup();
    const signal = new AbortController().signal;
    await expect(
      client.search({ ...query(), url: "https://invalid.test" } as SupplyReadQuery, signal),
    ).rejects.toMatchObject({ status: "unsupported" });
    await expect(
      client.search({ ...query(), departureOrigin: null }, signal),
    ).rejects.toMatchObject({ status: "unsupported" });
    expect(transport).not.toHaveBeenCalled();
  });
});
