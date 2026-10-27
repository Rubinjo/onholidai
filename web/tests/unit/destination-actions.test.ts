import { describe, expect, it } from "vitest";

import { selectDestination } from "../../components/trip-setup/destinations";

import type { PlaceCandidate } from "../../domain/trip/destination";

const country: PlaceCandidate = {
  placeId: "jp",
  kind: "country",
  name: "Japan",
  countryCode: "JP",
  timezone: "Asia/Tokyo",
  airportCode: null,
  location: null,
};
const tokyo: PlaceCandidate = {
  ...country,
  placeId: "tokyo",
  kind: "city",
  name: "Tokyo",
  location: { latitude: 35, longitude: 139 },
};
describe("country to city route selection", () => {
  it("replaces the whole country in place and allows another city", () => {
    const first = selectDestination([], country),
      next = selectDestination(first, tokyo);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ id: first[0].id, name: "Tokyo", routePosition: 0 });
    expect(selectDestination(next, { ...tokyo, placeId: "kyoto", name: "Kyoto" })).toHaveLength(2);
    expect(() => selectDestination(next, tokyo)).toThrow(/already/);
  });
  it("persists trusted supplier identities resolved for the selected place", () => {
    const airport: PlaceCandidate = {
      placeId: "ourairports:2513",
      kind: "airport",
      name: "Amsterdam Airport Schiphol",
      countryCode: "NL",
      timezone: "Europe/Amsterdam",
      airportCode: "AMS",
      location: { latitude: 52.3086, longitude: 4.7639 },
    };
    const [savedAirport] = selectDestination([], airport);
    expect(savedAirport).toMatchObject({
      kind: "place",
      providerPlaceIds: { lookup: "ourairports:2513", "duffel:flight": "AMS" },
    });
    const [savedCity] = selectDestination(
      [],
      { ...tokyo, providerPlaceIds: { "viator:destination": "334" } },
    );
    expect(savedCity.providerPlaceIds).toEqual({
      lookup: "tokyo",
      "viator:destination": "334",
    });
  });
});
