// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizePlanningOffer } from "../../server/supply/offers";
import { searchPlanningOffers, type SupplyReadProvider } from "../../server/supply/read";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

function offer() {
  const snapshot = createSyntheticTripSnapshot();
  const amount = (minorUnits: number) => ({ currency: "GBP", minorUnits });
  return {
    component: { id: "10000000-0000-4000-8000-000000000020", type: "accommodation", itineraryItemIds: [],
      provider: "synthetic", supplierOfferId: "synthetic-stay", offerStatus: "available",
      serviceStart: "2030-05-01T14:00:00+01:00", serviceEnd: "2030-05-08T10:00:00+01:00",
      travellerIds: ["10000000-0000-4000-8000-000000000021"], bookingRequirements: [], cancellationTerms: "Synthetic terms",
      price: { supplierAmount: amount(10000), platformMargin: amount(1000), customerPayableTaxes: amount(200),
        customerPayableFees: amount(100), finalCustomerAmount: amount(11300), status: "quoted", source: "synthetic",
        checkedAt: snapshot.price.checkedAt, expiresAt: "2030-01-02T00:00:00Z" },
      checkedAt: snapshot.price.checkedAt, expiresAt: "2030-01-02T00:00:00Z", bookingStatus: "unbooked",
      details: { occupancy: "Unknown occupancy", amenities: [] } },
    eligibility: { status: "unverified", minimumAge: null, maximumAge: null },
    occupancy: { maximumAdults: null, maximumChildren: null }, accessibility: "unverified",
    attribution: { provider: "synthetic", sourceUrl: null }, unverifiedFacts: [],
  };
}
function query() {
  const snapshot = createSyntheticTripSnapshot();
  return { componentTypes: ["accommodation"], currency: "GBP", departureOrigin: snapshot.departureOrigin,
    destinationIds: snapshot.destinations.map((destination) => destination.id), startDate: "2030-05-01",
    endDate: "2030-05-08", travellerParty: snapshot.travellerParty };
}

describe("read-only planning supply", () => {
  afterEach(() => vi.useRealTimers());

  it("preserves source attribution, marks missing facts and expires offers without inventing confirmations", () => {
    const normalized = normalizePlanningOffer(offer(), new Date("2030-01-03T00:00:00Z"));
    expect(normalized.unverifiedFacts).toEqual(["eligibility", "occupancy", "accessibility"]);
    expect(normalized.component.price.status).toBe("expired");
    expect(normalized.component.bookingStatus).toBe("unbooked");
    expect(() => normalizePlanningOffer({ ...offer(), component: { ...offer().component, bookingStatus: "confirmed" } })).toThrow();
  });

  it("returns provider failures separately from surviving normalized offers", async () => {
    const capabilities = { provider: "synthetic", search: ["accommodation"] as const, readOnly: true as const };
    const providers: SupplyReadProvider[] = [
      { capabilities: { ...capabilities, search: [...capabilities.search] }, search: async () => [offer()] },
      { capabilities: { provider: "offline", search: ["accommodation"], readOnly: true }, search: async () => { throw new Error("secret raw supplier response"); } },
    ];
    const result = await searchPlanningOffers(providers, query(), new Date("2030-01-01T00:00:00Z"));
    expect(result.offers).toHaveLength(1);
    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["available", "error"]);
    expect(JSON.stringify(result.outcomes)).not.toContain("secret raw supplier response");
  });

  it("finishes by the source deadline even when an adapter ignores abort", async () => {
    vi.useFakeTimers();
    const result = searchPlanningOffers([{ capabilities: { provider: "slow", search: ["accommodation"], readOnly: true },
      search: async () => new Promise<readonly unknown[]>(() => {}) }], query());
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await result).outcomes[0].status).toBe("deadline");
  });

  it("rejects flight research without a confirmed origin", async () => {
    await expect(searchPlanningOffers([], { ...query(), componentTypes: ["flight"], departureOrigin: null })).rejects.toThrow();
  });
});
