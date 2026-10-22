// @vitest-environment node
import { describe, expect, it } from "vitest";

import { createPlanningProviders } from "../../server/supply/providers";
import { createReadAdapter } from "../../server/supply/providers/adapter";
import { syntheticReadClient } from "../../server/supply/providers/synthetic";
import {
  materializePlanningOffer,
  normalizePlanningOffer,
  projectPublicPlanningOffer,
} from "../../server/supply/offers";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

const trip = createSyntheticTripSnapshot();
const query = {
  componentTypes: ["accommodation"] as ["accommodation"],
  currency: "GBP",
  departureOrigin: trip.departureOrigin,
  destinationIds: trip.destinations.map((place) => place.id),
  startDate: "2030-05-01",
  endDate: "2030-05-08",
  travellerParty: trip.travellerParty,
};

describe("incomplete discovery is not an accepted component", () => {
  it("preserves missing dates, fees, totals and terms as null, with safe public facts", async () => {
    const client = syntheticReadClient("accommodation");
    const adapter = createReadAdapter("duffel", "accommodation", {
      search: async (input, signal) =>
        ((await client.search(input, signal)) as Record<string, unknown>[]).map((hit) => ({
          ...hit,
          serviceStart: null,
          serviceEnd: null,
          terms: null,
          feesMinor: null,
          details: null,
        })),
    });
    const offer = normalizePlanningOffer(
      (await adapter.search(query, new AbortController().signal))[0],
    );
    expect(offer.component.serviceStart).toBeNull();
    expect(offer.component.price.finalCustomerAmount).toBeNull();
    expect(offer.unverifiedFacts).toEqual(
      expect.arrayContaining(["dates", "fees", "price", "terms", "details"]),
    );
    expect(projectPublicPlanningOffer(offer).component.price.finalCustomerMinor).toBeNull();
    expect(() => materializePlanningOffer(offer)).toThrow();
  });

  it("derives stable anonymous party slots across repeated product searches", async () => {
    const sources = createPlanningProviders("deterministic");
    const first = await sources[0].search(query, new AbortController().signal);
    const again = await sources[0].search(query, new AbortController().signal);
    expect(normalizePlanningOffer(first[0]).component.travellerIds).toEqual(
      normalizePlanningOffer(again[0]).component.travellerIds,
    );
  });

  it("does not promote legacy evidence to live and redacts nested canaries", async () => {
    const source = createPlanningProviders("deterministic")[1];
    const offer = normalizePlanningOffer(
      (await source.search(query, new AbortController().signal))[0],
    );
    const incomplete = {
      ...offer,
      component: {
        ...offer.component,
        serviceStart: null,
        details: { occupancy: "secret passenger passport", amenities: ["commission amount"] },
      },
    };
    const result = projectPublicPlanningOffer(incomplete);
    expect(result.evidence).toBeUndefined();
    expect(result.sourceMode).toBe("unknown");
    expect(JSON.stringify(result)).not.toMatch(/passenger passport|commission amount/);
    expect(() =>
      normalizePlanningOffer({
        ...incomplete,
        evidence: {
          status: "live_revalidated",
          availability: "available",
          checkedAt: offer.component.checkedAt,
          expiresAt: null,
        },
      }),
    ).toThrow();
  });
});
