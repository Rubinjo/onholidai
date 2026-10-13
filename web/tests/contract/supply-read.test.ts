import { describe, expect, it } from "vitest";
import { createDuffelReadProvider } from "../../server/supply/providers/duffel-read";
import { createBookingReadProvider } from "../../server/supply/providers/booking-read";
import { syntheticReadClient } from "../../server/supply/providers/synthetic";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { searchPlanningOffers } from "../../server/supply/read";
describe("injected planning suppliers", () => {
  it("maps deterministic quotes without granting supplier write capabilities", async () => {
    const trip = createSyntheticTripSnapshot();
    const providers = [createDuffelReadProvider(syntheticReadClient("flight")), createBookingReadProvider(syntheticReadClient("accommodation"))];
    const result = await searchPlanningOffers(providers, { componentTypes: ["flight", "accommodation"], currency: "GBP",
      departureOrigin: trip.departureOrigin, destinationIds: trip.destinations.map((destination) => destination.id),
      startDate: "2030-05-01", endDate: "2030-05-08", travellerParty: { adults: 2, children: [] } });
    expect(result.offers).toHaveLength(2);
    expect(result.offers.every((offer) => offer.component.bookingStatus === "unbooked" && offer.accessibility === "unverified")).toBe(true);
    expect(providers.every((provider) => provider.capabilities.readOnly)).toBe(true);
    expect(result.offers[0].component.price.finalCustomerAmount.minorUnits).toBeGreaterThan(0);
  });
  it("fails closed for rate limits and credentials without leaking vendor errors", async () => {
    const trip = createSyntheticTripSnapshot();
    const provider = createDuffelReadProvider({ search: async () => { throw new Error("429 secret credential"); } });
    const result = await searchPlanningOffers([provider], { componentTypes: ["flight"], currency: "GBP",
      departureOrigin: trip.departureOrigin, destinationIds: trip.destinations.map((destination) => destination.id),
      startDate: "2030-05-01", endDate: "2030-05-08", travellerParty: trip.travellerParty });
    expect(result.offers).toEqual([]); expect(JSON.stringify(result)).not.toContain("secret");
  });
});
