import { describe, expect, it } from "vitest";
import { selectDestination } from "../../components/trip-setup/destinations";
import type { PlaceCandidate } from "../../domain/trip/destination";
const country: PlaceCandidate = { placeId: "jp", kind: "country", name: "Japan", countryCode: "JP", timezone: "Asia/Tokyo", airportCode: null, location: null };
const tokyo: PlaceCandidate = { ...country, placeId: "tokyo", kind: "city", name: "Tokyo", location: { latitude: 35, longitude: 139 } };
describe("country to city route selection", () => {
  it("replaces the whole country in place and allows another city", () => {
    const first = selectDestination([], country), next = selectDestination(first, tokyo);
    expect(next).toHaveLength(1); expect(next[0]).toMatchObject({ id: first[0].id, name: "Tokyo", routePosition: 0 });
    expect(selectDestination(next, { ...tokyo, placeId: "kyoto", name: "Kyoto" })).toHaveLength(2);
    expect(() => selectDestination(next, tokyo)).toThrow(/already/);
  });
});
