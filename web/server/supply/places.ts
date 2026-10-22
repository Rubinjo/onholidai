import { type PlaceLookupProvider, type PlaceCandidate } from "@/domain/trip/destination";
import { ProblemError } from "@/server/errors";

const syntheticPlaces: readonly PlaceCandidate[] = [
  {
    placeId: "synthetic-portugal-mainland",
    kind: "country",
    name: "Portugal (mainland)",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
    airportCode: null,
    location: null,
  },
  {
    placeId: "synthetic-portugal-azores",
    kind: "country",
    name: "Portugal (Azores)",
    countryCode: "PT",
    timezone: "Atlantic/Azores",
    airportCode: null,
    location: null,
  },
  {
    placeId: "synthetic-lisbon",
    kind: "city",
    name: "Lisbon",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
    airportCode: null,
    location: { latitude: 38.7223, longitude: -9.1393 },
  },
  {
    placeId: "synthetic-coimbra",
    kind: "city",
    name: "Coimbra",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
    airportCode: null,
    location: { latitude: 40.2033, longitude: -8.4103 },
  },
  {
    placeId: "synthetic-porto",
    kind: "city",
    name: "Porto",
    countryCode: "PT",
    timezone: "Europe/Lisbon",
    airportCode: null,
    location: { latitude: 41.1579, longitude: -8.6291 },
  },
  {
    placeId: "synthetic-amsterdam",
    kind: "city",
    name: "Amsterdam",
    countryCode: "NL",
    timezone: "Europe/Amsterdam",
    airportCode: null,
    location: { latitude: 52.3676, longitude: 4.9041 },
  },
  {
    placeId: "synthetic-ams",
    kind: "airport",
    name: "Amsterdam Schiphol",
    countryCode: "NL",
    timezone: "Europe/Amsterdam",
    airportCode: "AMS",
    location: { latitude: 52.3105, longitude: 4.7683 },
  },
  {
    placeId: "synthetic-japan",
    kind: "country",
    name: "Japan",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
    airportCode: null,
    location: null,
  },
  {
    placeId: "synthetic-south-korea",
    kind: "country",
    name: "South Korea",
    countryCode: "KR",
    timezone: "Asia/Seoul",
    airportCode: null,
    location: null,
  },
  {
    placeId: "synthetic-tokyo",
    kind: "city",
    name: "Tokyo",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
    airportCode: null,
    location: { latitude: 35.6762, longitude: 139.6503 },
  },
  {
    placeId: "synthetic-kyoto",
    kind: "city",
    name: "Kyoto",
    countryCode: "JP",
    timezone: "Asia/Tokyo",
    airportCode: null,
    location: { latitude: 35.0116, longitude: 135.7681 },
  },
  {
    placeId: "synthetic-seoul",
    kind: "city",
    name: "Seoul",
    countryCode: "KR",
    timezone: "Asia/Seoul",
    airportCode: null,
    location: { latitude: 37.5665, longitude: 126.978 },
  },
];

export function createPlaceLookupProvider(mode: "deterministic" | "live"): PlaceLookupProvider {
  return {
    async search(input) {
      if (mode !== "deterministic")
        throw new ProblemError({
          status: 503,
          code: "place_lookup_unavailable",
          title: "Place lookup is currently unavailable",
        });
      return syntheticPlaces
        .filter(
          (place) =>
            place.name.toLowerCase().includes(input.query.toLowerCase()) &&
            (!input.countryCode || place.countryCode === input.countryCode) &&
            (!input.kind || place.kind === input.kind),
        )
        .slice(0, 20);
    },
  };
}
