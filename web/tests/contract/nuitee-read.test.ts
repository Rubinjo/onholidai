// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { bookingTermsV2Schema } from "../../domain/booking/authorization";
import { tripSnapshotSchema } from "../../domain/trip/schema";
import { createNuiteeHttpClient } from "../../server/supply/providers/nuitee-http";
import { createNuiteeReadProvider } from "../../server/supply/providers/nuitee-read";
import { normalizePlanningOffer, projectPublicPlanningOffer } from "../../server/supply/offers";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { nuiteeRatesResponse as rates } from "../fixtures/providers";
import { wholeTripReviewFixture, wholeTripTermsFixture } from "../fixtures/whole-trip-review";

import type { SupplyReadQuery } from "../../server/supply/read";

const query: SupplyReadQuery = {
  componentTypes: ["accommodation"],
  currency: "GBP",
  departureOrigin: null,
  destinationIds: createSyntheticTripSnapshot().destinations.map((place) => place.id),
  startDate: "2030-05-01",
  endDate: "2030-05-08",
  travellerParty: { adults: 2, children: [] },
};
const selection = {
  hotelIds: ["synthetic_hotel"],
  guestNationality: "GB",
  occupancies: [{ adults: 2, children: [] }],
};
function setup(response: unknown = rates()) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(response));
  const client = createNuiteeHttpClient({
    apiKey: "synthetic-nuitee-secret",
    environment: "sandbox",
    fetch,
    now: () => new Date("2030-04-01T00:00:00Z"),
    resolveSearch: () => selection,
  });
  return { fetch, client, provider: createNuiteeReadProvider(client) };
}
afterEach(() => vi.useRealTimers());

describe("Nuitee safe hotel wire mappings", () => {
  it.each([
    ["object", "object"],
    ["object", "array"],
    ["array", "object"],
  ])(
    "maps %s retail and %s selling totals without assuming net price is public",
    async (retail, selling) => {
      const wire = rates();
      const hotel = wire.data[0];
      const original = hotel.roomTypes[0];
      const { provider } = setup({
        data: [
          {
            ...hotel,
            roomTypes: [
              {
                ...original,
                offerId: `${"Q".repeat(1152)}+/==`,
                offerRetailRate:
                  retail === "object" ? original.offerRetailRate[0] : original.offerRetailRate,
                suggestedSellingPrice:
                  selling === "object"
                    ? original.suggestedSellingPrice[0]
                    : original.suggestedSellingPrice,
              },
            ],
          },
        ],
      });
      const [offer] = await provider.search(query, new AbortController().signal);
      const projected = projectPublicPlanningOffer(offer);
      expect(projected.component.price.finalCustomerMinor).toBe(11520);
      expect(JSON.stringify(projected)).not.toMatch(
        /supplierAmount|offerRetailRate|platformMargin/,
      );
    },
  );

  it.each(["object", "array"])(
    "keeps ambiguous property charges out of an enriched %s public total",
    async (form) => {
      const wire = rates();
      const hotel = wire.data[0];
      const original = hotel.roomTypes[0];
      const price = { ...original.suggestedSellingPrice[0], source: "synthetic-public-source" };
      const { provider } = setup({
        data: [
          {
            ...hotel,
            roomTypes: [
              {
                ...original,
                offerRetailRate: original.offerRetailRate[0],
                suggestedSellingPrice: form === "object" ? price : [price],
              },
            ],
          },
        ],
      });
      const [offer] = await provider.search(query, new AbortController().signal);
      const projected = projectPublicPlanningOffer(offer);
      expect(projected.component.price.finalCustomerMinor).toBeNull();
      expect(projected.unverifiedFacts).toContain("price");
    },
  );

  it("retains an enriched public total when there are no additional property charges to infer", async () => {
    const wire = rates();
    const hotel = wire.data[0];
    const original = hotel.roomTypes[0];
    for (const charge of original.rates[0].retailRate.taxesAndFees) charge.included = true;
    const { provider } = setup({
      data: [
        {
          ...hotel,
          roomTypes: [
            {
              ...original,
              offerRetailRate: original.offerRetailRate[0],
              suggestedSellingPrice: {
                ...original.suggestedSellingPrice[0],
                source: "synthetic-public-source",
              },
            },
          ],
        },
      ],
    });
    const [offer] = await provider.search(query, new AbortController().signal);
    expect(projectPublicPlanningOffer(offer).component.price.finalCustomerMinor).toBe(11020);
  });

  it.each(["currency", "precision", "total", "missing", "multiple"])(
    "rejects %s errors in object-form offer totals instead of inventing a price",
    async (fault) => {
      const wire = rates();
      const hotel = wire.data[0];
      const original = hotel.roomTypes[0];
      const retail = { ...original.offerRetailRate[0] };
      if (fault === "currency") retail.currency = "USD";
      if (fault === "precision") retail.amount = "100.101";
      if (fault === "total") retail.amount = "100.11";
      const { provider } = setup({
        data: [
          {
            ...hotel,
            roomTypes: [
              {
                ...original,
                offerRetailRate:
                  fault === "missing" ? {} : fault === "multiple" ? [retail, retail] : retail,
                suggestedSellingPrice: original.suggestedSellingPrice[0],
              },
            ],
          },
        ],
      });
      await expect(provider.search(query, new AbortController().signal)).rejects.toHaveProperty(
        "status",
      );
    },
  );

  it("preserves realistic encoded offer/rate IDs across the adapter and public canonical schema", async () => {
    const wire = rates();
    const offerId = `${"Q".repeat(1152)}+/==`;
    const rateId = "r".repeat(549);
    wire.data[0].roomTypes[0].offerId = offerId;
    wire.data[0].roomTypes[0].rates[0].rateId = rateId;
    const { provider } = setup(wire);
    const offers = await provider.search(query, new AbortController().signal);
    const projected = projectPublicPlanningOffer(offers[0]);
    expect(projected.component.supplierOfferId).toBe(offerId);
    expect(projected.supplierReferences?.rateIds).toEqual([rateId]);
    expect(normalizePlanningOffer(offers[0]).component.supplierOfferId).toBe(offerId);
  });

  it("keeps long supplier IDs intact in accepted snapshots and whole-trip evidence/consent", () => {
    const fixture = wholeTripReviewFixture();
    const stay = fixture.snapshot.components.find((entry) => entry.provider === "nuitee")!;
    const proof = fixture.evidence.find((entry) => entry.componentId === stay.id)!;
    const offerId = `${"Q".repeat(1152)}+/==`;
    stay.supplierOfferId = offerId;
    proof.supplierOfferId = offerId;
    const snapshot = tripSnapshotSchema.parse(fixture.snapshot);
    const terms = bookingTermsV2Schema.parse(wholeTripTermsFixture(fixture));
    expect(snapshot.components.find((entry) => entry.id === stay.id)?.supplierOfferId).toBe(
      offerId,
    );
    expect(
      terms.components.find((entry) => entry.componentId === stay.id)?.evidence.supplierOfferId,
    ).toBe(offerId);
  });

  it("keeps 32 representative long-ID public offers inside the existing MCP output budget", async () => {
    const wire = rates();
    const template = structuredClone(wire.data[0].roomTypes[0]);
    wire.data[0].roomTypes = Array.from({ length: 32 }, (_, index) => ({
      ...structuredClone(template),
      offerId: `${"Q".repeat(1150)}${String(index).padStart(2, "0")}+/==`,
      rates: [{ ...structuredClone(template.rates[0]), rateId: "r".repeat(549) }],
    }));
    const { provider } = setup(wire);
    const offers = (await provider.search(query, new AbortController().signal)).map((offer) =>
      projectPublicPlanningOffer(offer),
    );
    expect(offers).toHaveLength(32);
    expect(Buffer.byteLength(JSON.stringify({ offers }))).toBeLessThanOrEqual(262144);
  });

  it.each(["offer", "rate"])("accepts a bounded 4096-character opaque %s ID", async (field) => {
    const wire = rates();
    const value = `${"Q".repeat(4092)}+/==`;
    if (field === "offer") wire.data[0].roomTypes[0].offerId = value;
    else wire.data[0].roomTypes[0].rates[0].rateId = value;
    const { provider } = setup(wire);
    const [offer] = await provider.search(query, new AbortController().signal);
    const projected = projectPublicPlanningOffer(offer);
    expect(
      field === "offer"
        ? projected.component.supplierOfferId
        : projected.supplierReferences?.rateIds?.[0],
    ).toBe(value);
  });

  it.each([
    ["offer", "Q".repeat(4097)],
    ["rate", "r".repeat(4097)],
    ["offer", "https://example.invalid/token"],
    ["rate", "rate\nvalue"],
    ["offer", "offer value"],
  ])("rejects oversized or unsafe opaque %s IDs (%#)", async (field, value) => {
    const wire = rates();
    if (field === "offer") wire.data[0].roomTypes[0].offerId = value;
    else wire.data[0].roomTypes[0].rates[0].rateId = value;
    const { provider } = setup(wire);
    await expect(provider.search(query, new AbortController().signal)).rejects.toHaveProperty(
      "status",
      "unsupported",
    );
  });

  it("maps selected public pricing without double-counting included fees or exposing supplier economics", async () => {
    const { fetch, provider } = setup();
    const offers = await provider.search(query, new AbortController().signal);
    const offer = projectPublicPlanningOffer(offers[0]);
    expect(offer.component.provider).toBe("nuitee");
    expect(offer.component.price.finalCustomerMinor).toBe(11520);
    expect(offer.component.price.status).toBe("estimated");
    expect(offer.component.serviceStart).toBeNull();
    expect(offer.component.serviceEnd).toBeNull();
    expect(offer.component.expiresAt).toBeNull();
    expect(offer.supplierReferences).toMatchObject({
      accommodationId: "synthetic_hotel",
      rateIds: ["synthetic_rate"],
      roomIds: ["synthetic_room"],
    });
    expect(offer.component.planningDetails?.fareConditions).toContain("Property charge");
    expect(offer.component.planningDetails?.fareConditions).toContain('"minor":10010');
    expect(JSON.stringify(offer)).not.toMatch(
      /synthetic-nuitee-secret|supplierAmount|platformMargin|offerRetailRate/,
    );
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.liteapi.travel/v3.0/hotels/rates");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      ...selection,
      checkin: query.startDate,
      checkout: query.endDate,
      currency: "GBP",
      timeout: 6,
      limit: 32,
    });
    expect(provider.capabilities.operations?.revalidation).toBe("unsupported");
    expect(provider.revalidate).toBeUndefined();
  });

  it("looks up granted property content and rates without prebook, payment, arbitrary URL or cross-query access", async () => {
    const { fetch, client } = setup();
    await client.search(query, new AbortController().signal);
    fetch.mockImplementation(async (url) =>
      String(url).includes("/data/hotel")
        ? Response.json({
            data: { id: "synthetic_hotel", name: "Synthetic apartment", hotelType: "apartment" },
          })
        : Response.json(rates()),
    );
    const hit = await client.detail("synthetic_offer", query, new AbortController().signal);
    expect(hit.planningDetails.accommodationType).toBe("apartment");
    expect(hit.supplierReferences.rateIds).toEqual(["synthetic_rate"]);
    const before = fetch.mock.calls.length;
    for (const id of ["https://untrusted.example", "ungranted"]) {
      await expect(client.detail(id, query, new AbortController().signal)).rejects.toMatchObject({
        status: "unsupported",
      });
    }
    await expect(
      client.detail(
        "synthetic_offer",
        { ...query, endDate: "2030-05-09" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ status: "unsupported" });
    expect(fetch.mock.calls).toHaveLength(before);
    expect(
      fetch.mock.calls.every(
        ([url]) => !String(url).match(/prebook|book\.|payment|flights|experiences/),
      ),
    ).toBe(true);
  });

  it("requires exact trusted occupancy, nationality and a bounded location before calling suppliers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    for (const invalid of [
      null,
      { ...selection, guestNationality: "" },
      { ...selection, occupancies: [{ adults: 1, children: [] }] },
      { ...selection, hotelIds: ["https://untrusted.example"] },
      { ...selection, occupancies: [{ adults: 2, children: [4] }] },
    ]) {
      const client = createNuiteeHttpClient({
        apiKey: "synthetic-key",
        environment: "sandbox",
        fetch,
        resolveSearch: () => invalid,
      });
      await expect(client.search(query, new AbortController().signal)).rejects.toMatchObject({
        status: "access_blocked",
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["currency", "occupancy", "precision", "overflow", "total"])(
    "rejects inconsistent %s evidence rather than fabricating a complete offer",
    async (fault) => {
      const wire = rates();
      const offer = wire.data[0].roomTypes[0];
      if (fault === "currency") offer.offerRetailRate[0].currency = "USD";
      if (fault === "occupancy") offer.rates[0].adultCount = 1;
      if (fault === "precision") offer.offerRetailRate[0].amount = "100.101";
      if (fault === "overflow") offer.offerRetailRate[0].amount = "9007199254740992";
      if (fault === "total") offer.offerRetailRate[0].amount = "100.11";
      const { client } = setup(wire);
      await expect(client.search(query, new AbortController().signal)).rejects.toHaveProperty(
        "status",
      );
    },
  );

  it("keeps absent public pricing unknown and never substitutes net rate or guessed fees", async () => {
    const wire = rates();
    const offer = { ...wire.data[0].roomTypes[0], suggestedSellingPrice: undefined };
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        data: [{ ...wire.data[0], roomTypes: [offer] }],
      }),
    );
    const provider = createNuiteeReadProvider(
      createNuiteeHttpClient({
        apiKey: "synthetic-key",
        environment: "sandbox",
        fetch,
        resolveSearch: () => selection,
      }),
    );
    const offers = await provider.search(query, new AbortController().signal);
    expect(projectPublicPlanningOffer(offers[0]).component.price.finalCustomerMinor).toBeNull();
  });

  it("preserves exact multi-room allocation, room/rate identities, child ages and total arithmetic", async () => {
    const wire = rates();
    const offer = wire.data[0].roomTypes[0];
    const first = offer.rates[0];
    first.adultCount = 1;
    first.childCount = 1;
    first.childrenAges = [7];
    offer.rates.push({
      ...structuredClone(first),
      rateId: "second_rate",
      mappedRoomId: "second_room",
      occupancyNumber: 2,
      childCount: 0,
      childrenAges: [],
    });
    offer.offerRetailRate[0].amount = "200.20";
    offer.suggestedSellingPrice[0].amount = "220.40";
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(wire));
    const client = createNuiteeHttpClient({
      apiKey: "synthetic-key",
      environment: "sandbox",
      fetch,
      resolveSearch: () => ({
        ...selection,
        sessionId: "sourced_session",
        occupancies: [
          { adults: 1, children: [7] },
          { adults: 1, children: [] },
        ],
      }),
    });
    const request = {
      ...query,
      travellerParty: {
        adults: 2,
        children: [
          {
            id: "10000000-0000-4000-8000-000000000011",
            ageAtTripStart: 7,
          },
        ],
      },
    };
    const hits = await client.search(request, new AbortController().signal);
    expect(hits[0].customerMinor).toBe(23040);
    expect(hits[0].supplierReferences).toMatchObject({
      rateIds: ["synthetic_rate", "second_rate"],
      roomIds: ["synthetic_room", "second_room"],
      sessionId: "sourced_session",
    });
    expect(hits[0].planningDetails.fareConditions).toContain('"childAges":[7]');
    offer.rates[1].occupancyNumber = 1;
    await expect(client.search(request, new AbortController().signal)).rejects.toHaveProperty(
      "status",
    );
  });

  it.each(["missing", "foreign", "package", "membership"])(
    "does not claim a complete public total for %s charges or restrictions",
    async (kind) => {
      const wire = rates();
      const offer = wire.data[0].roomTypes[0];
      if (kind === "foreign") offer.rates[0].retailRate.taxesAndFees[1].currency = "EUR";
      if (kind === "package") offer.rateType = "package";
      const { taxesAndFees, ...retail } = offer.rates[0].retailRate;
      const payload =
        kind === "missing"
          ? {
              data: [
                {
                  ...wire.data[0],
                  roomTypes: [
                    {
                      ...offer,
                      rates: [{ ...offer.rates[0], retailRate: retail }],
                    },
                  ],
                },
              ],
            }
          : kind === "membership"
            ? {
                data: [
                  { ...wire.data[0], roomTypes: [{ ...offer, loyaltyMembershipIdRequired: true }] },
                ],
              }
            : wire;
      expect(taxesAndFees).toHaveLength(2);
      const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(payload));
      const client = createNuiteeHttpClient({
        apiKey: "synthetic-key",
        environment: "sandbox",
        fetch,
        resolveSearch: () => selection,
      });
      const [hit] = await client.search(query, new AbortController().signal);
      expect(hit.customerMinor).toBeNull();
    },
  );

  it("preserves numeric source precision before minor-unit validation", async () => {
    const wire = JSON.stringify(rates()).replace('"100.10"', "100.10000000000000001");
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(wire, {
          headers: { "Content-Type": "application/json" },
        }),
    );
    const client = createNuiteeHttpClient({
      apiKey: "synthetic-key",
      environment: "sandbox",
      fetch,
      resolveSearch: () => selection,
    });
    await expect(client.search(query, new AbortController().signal)).rejects.toHaveProperty(
      "status",
    );
  });

  it("does not return old detail when the selected offer is removed or changed", async () => {
    const { client, fetch } = setup();
    await client.search(query, new AbortController().signal);
    const changed = rates();
    changed.data[0].roomTypes[0].offerId = "replacement_offer";
    fetch.mockImplementation(async (url) =>
      Response.json(
        String(url).includes("/data/hotel") ? { data: { id: "synthetic_hotel" } } : changed,
      ),
    );
    await expect(
      client.detail("synthetic_offer", query, new AbortController().signal),
    ).rejects.toMatchObject({ status: "unsupported" });
  });

  it.each([
    [401, "access_blocked"],
    [429, "rate_limited"],
    [500, "error"],
  ] as const)(
    "returns safe %s transport failures without provider text or uncontrolled retries",
    async (status, expected) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response("synthetic-key sensitive upstream message", {
            status,
            headers: { "Retry-After": "1" },
          }),
      );
      const client = createNuiteeHttpClient({
        apiKey: "synthetic-key",
        environment: "sandbox",
        fetch,
        resolveSearch: () => selection,
      });
      try {
        await client.search(query, new AbortController().signal);
        expect.unreachable();
      } catch (error) {
        expect(error).toMatchObject({ status: expected });
        expect(String(error)).not.toMatch(/synthetic-key|sensitive upstream/);
      }
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("rejects malformed or oversized wire evidence and pre-cancelled reads", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("{malformed"));
    const client = createNuiteeHttpClient({
      apiKey: "synthetic-key",
      environment: "sandbox",
      fetch,
      resolveSearch: () => selection,
    });
    await expect(client.search(query, AbortSignal.abort())).rejects.toHaveProperty("status");
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.search(query, new AbortController().signal)).rejects.toHaveProperty(
      "status",
    );
    fetch.mockImplementation(async () => new Response("x".repeat(1_048_577)));
    await expect(client.search(query, new AbortController().signal)).rejects.toHaveProperty(
      "status",
    );
  });

  it("rejects ambiguous offer identities across properties instead of retargeting detail", async () => {
    const wire = rates();
    wire.data.push({ ...structuredClone(wire.data[0]), hotelId: "second_hotel" });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(wire));
    const client = createNuiteeHttpClient({
      apiKey: "synthetic-key",
      environment: "sandbox",
      fetch,
      resolveSearch: () => ({ ...selection, hotelIds: ["synthetic_hotel", "second_hotel"] }),
    });
    await expect(client.search(query, new AbortController().signal)).rejects.toMatchObject({
      status: "error",
    });
    await expect(
      client.detail("synthetic_offer", query, new AbortController().signal),
    ).rejects.toMatchObject({
      status: "unsupported",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("enforces the six-second shopping bound even when fetch ignores cancellation", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}));
    const client = createNuiteeHttpClient({
      apiKey: "synthetic-key",
      environment: "sandbox",
      fetch,
      resolveSearch: () => selection,
    });
    const pending = expect(
      client.search(query, new AbortController().signal),
    ).rejects.toHaveProperty("status");
    await vi.advanceTimersByTimeAsync(6000);
    await pending;
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
});
