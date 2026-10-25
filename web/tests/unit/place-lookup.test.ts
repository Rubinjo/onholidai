import { describe, expect, it, vi } from "vitest";

import { planningError, PlanningRequestError } from "../../components/trip-setup/http";
import { placeCandidateSchema, type PlaceCandidate } from "../../domain/trip/destination";
import { problemResponse } from "../../server/errors";
import { createPlaceLookupProvider } from "../../server/supply/places";
import catalogue from "../../server/supply/geo-catalogue.json";

const signal = () => new AbortController().signal;

const lisbonCity = {
  id: "ChIJO_PkYRozGQ0R0DaQ5L3rAAQ",
  displayName: { text: "Lisbon" },
  location: { latitude: 38.7222524, longitude: -9.1393366 },
  types: ["locality", "political"],
  addressComponents: [
    { shortText: "Lisbon", types: ["locality", "political"] },
    { shortText: "PT", types: ["country", "political"] },
  ],
};

const lisbonAirport = {
  id: "ChIJVVVVVhxZRw0R1Hdr3ZhFj8w",
  displayName: { text: "Humberto Delgado Airport" },
  location: { latitude: 38.7813, longitude: -9.1359 },
  types: ["international_airport", "airport", "point_of_interest"],
  addressComponents: [
    { shortText: "Lisbon", types: ["locality", "political"] },
    { shortText: "PT", types: ["country", "political"] },
  ],
};

function upstream(places: readonly unknown[], timeZoneId = "Europe/Lisbon") {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://places.googleapis.com/v1/places:searchText"))
      return Response.json({ places });
    if (url.startsWith("https://maps.googleapis.com/maps/api/timezone/json"))
      return Response.json(timeZoneId ? { status: "OK", timeZoneId } : { status: "ZERO_RESULTS" });
    return new Response("unexpected upstream", { status: 500 });
  });
}

describe("place lookup", () => {
  it("keeps the reviewed deterministic catalogue for deterministic mode", async () => {
    const provider = createPlaceLookupProvider("deterministic");
    await expect(provider.search({ query: "lisbon" }, signal())).resolves.toMatchObject([
      { placeId: "synthetic-lisbon", kind: "city" },
    ]);
  });

  it("reports live mode without a provider key as unavailable", async () => {
    const provider = createPlaceLookupProvider("live");
    await expect(provider.search({ query: "Lisbon" }, signal())).rejects.toMatchObject({
      status: 503,
      code: "place_lookup_unavailable",
    });
  });

  it("maps live text search results with their authoritative timezone", async () => {
    const provider = createPlaceLookupProvider("live", {
      apiKey: "test-key",
      fetch: upstream([lisbonCity]),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const results = await provider.search({ query: "Lisbon" }, signal());
    expect(results).toContainEqual({
      placeId: `google:${lisbonCity.id}`,
      kind: "city",
      name: "Lisbon",
      countryCode: "PT",
      timezone: "Europe/Lisbon",
      airportCode: null,
      location: { latitude: 38.7222524, longitude: -9.1393366 },
    });
  });

  it("keeps a station out of the city list and collapses identical names", async () => {
    const station = {
      id: "ChIJstation",
      displayName: { text: "Tokyo Station" },
      location: { latitude: 35.6812, longitude: 139.7671 },
      types: ["train_station", "transit_station", "point_of_interest", "establishment"],
      addressComponents: [
        { shortText: "Chiyoda", types: ["locality", "political"] },
        { shortText: "JP", types: ["country", "political"] },
      ],
    };
    const provider = createPlaceLookupProvider("live", {
      apiKey: "test-key",
      fetch: upstream([station, { ...station, id: "ChIJstation2" }]),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const results = await provider.search({ query: "Tokyo Station" }, signal());
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "Tokyo Station", kind: "place" });
  });

  it("adopts the bundled IATA identity for text search airport matches", async () => {
    const provider = createPlaceLookupProvider("live", {
      apiKey: "test-key",
      fetch: upstream([lisbonAirport]),
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    const results = await provider.search({ query: "Lisbon airport", kind: "airport" }, signal());
    expect(results).toContainEqual(
      expect.objectContaining({ placeId: "ourairports:4461", airportCode: "LIS", kind: "airport" }),
    );
  });

  it("answers country quick-picks from the bundled catalogue without an upstream call", async () => {
    const request = upstream([lisbonCity]);
    const provider = createPlaceLookupProvider("live", { apiKey: "test-key", fetch: request });
    const results = await provider.search({ query: "", countryCode: "PT", kind: "city" }, signal());
    expect(request).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ name: "Lisbon", countryCode: "PT", kind: "city" });
    expect(results.length).toBeGreaterThan(3);
  });

  it("falls back to the bundled catalogue when text search is unavailable", async () => {
    const provider = createPlaceLookupProvider("live", {
      apiKey: "test-key",
      fetch: vi.fn(async () => new Response("upstream down", { status: 503 })),
    });
    const results = await provider.search({ query: "Lisbon" }, signal());
    expect(results).toContainEqual(
      expect.objectContaining({ placeId: "geonames:2267057", name: "Lisbon", kind: "city" }),
    );
  });

  it("stays unavailable when neither text search nor the catalogue can answer", async () => {
    const provider = createPlaceLookupProvider("live", {
      apiKey: "test-key",
      fetch: vi.fn(async () => new Response("upstream down", { status: 503 })),
    });
    await expect(provider.search({ query: "zzzzqqq" }, signal())).rejects.toMatchObject({
      code: "place_lookup_unavailable",
    });
  });

  it("keeps every bundled place schema-valid, unique and broadly scoped", () => {
    const places = catalogue.places as unknown as (PlaceCandidate & {
      rank: number;
      city?: string;
    })[];
    const invalid = places.filter(
      (place) =>
        !placeCandidateSchema.safeParse({
          placeId: place.placeId,
          kind: place.kind,
          name: place.name,
          countryCode: place.countryCode,
          timezone: place.timezone,
          airportCode: place.airportCode,
          location: place.location,
        }).success,
    );
    expect(invalid).toEqual([]);
    expect(new Set(places.map((place) => place.placeId)).size).toBe(places.length);
    expect(new Set(places.map((place) => place.countryCode)).size).toBeGreaterThan(200);
    expect(places.some((place) => place.kind === "airport" && place.airportCode === "LIS")).toBe(
      true,
    );
  });
});

describe("problem surfacing", () => {
  it("preserves a problem raised by a duplicated module copy", async () => {
    const duplicated = {
      name: "ProblemError",
      type: "about:blank",
      title: "Place lookup is currently unavailable",
      status: 503,
      code: "place_lookup_unavailable",
      [Symbol.for("onholidai.problem-error")]: true,
    };
    const response = problemResponse(duplicated, "5f0b1f4e-3ab8-4a35-9a21-2f5f43e6c5e8");
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "place_lookup_unavailable" });
  });

  it("explains an unavailable destination search instead of blaming the input", () => {
    expect(planningError(new PlanningRequestError(503, "place_lookup_unavailable"))).toMatch(
      /destination search is unavailable/i,
    );
  });
});
