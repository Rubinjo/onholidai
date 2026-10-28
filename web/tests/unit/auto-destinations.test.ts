import { describe, expect, it } from "vitest";

import { destinationSchema } from "../../domain/trip/schema";
import { autoSelectCities, automaticCityLimit } from "../../server/trip/auto-destinations";

const japan = destinationSchema.parse({
  id: "10000000-0000-4000-8000-000000000001",
  kind: "country",
  name: "Japan",
  countryCode: "JP",
  providerPlaceIds: { synthetic: "synthetic-japan" },
  location: null,
  routePosition: 0,
  arrivalDate: null,
  departureDate: null,
  plannedNights: 0,
});

describe("automatic city selection", () => {
  it("replaces a country-only selection with sourced cities sized to the trip", () => {
    const destinations = autoSelectCities([japan], 10, "deterministic");
    expect(destinations.map((place) => place.name)).toEqual(["Tokyo", "Kyoto"]);
    expect(destinations.every((place) => place.kind === "city")).toBe(true);
    expect(destinations.every((place) => place.countryCode === "JP")).toBe(true);
    expect(destinations.every((place) => place.providerPlaceIds.lookup)).toBe(true);
    expect(new Set(destinations.map((place) => place.id)).size).toBe(2);
    expect(destinations.map((place) => place.routePosition)).toEqual([0, 1]);
    for (const place of destinations) expect(() => destinationSchema.parse(place)).not.toThrow();
    expect(automaticCityLimit(4)).toBe(1);
    expect(automaticCityLimit(7)).toBe(2);
    expect(automaticCityLimit(12)).toBe(3);
  });

  it("suggests separate population centres from the bundled catalogue in live mode", () => {
    const destinations = autoSelectCities([japan], 10, "live");
    expect(destinations).toHaveLength(2);
    expect(destinations.every((place) => place.countryCode === "JP")).toBe(true);
    expect(destinations[0].name).toBe("Tokyo");
    expect(destinations.every((place) => destinationSchema.safeParse(place).success)).toBe(true);
  });

  it("never overrides explicit cities and keeps country-only selections when no city is sourced", () => {
    const tokyo = destinationSchema.parse({
      ...japan,
      id: "10000000-0000-4000-8000-000000000002",
      kind: "city",
      name: "Tokyo",
      providerPlaceIds: { lookup: "synthetic-tokyo" },
      location: { latitude: 35.6762, longitude: 139.6503 },
    });
    expect(autoSelectCities([tokyo], 10, "deterministic")).toEqual([tokyo]);
    const unknown = destinationSchema.parse({ ...japan, countryCode: "ZZ" });
    expect(autoSelectCities([unknown], 10, "deterministic")).toEqual([unknown]);
  });
});
