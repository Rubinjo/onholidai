import { type PlaceLookupProvider, type PlaceCandidate } from "@/domain/trip/destination";
import { ProblemError } from "@/server/errors";

const syntheticPlaces: readonly PlaceCandidate[] = [
  { placeId: "synthetic-amsterdam", kind: "city", name: "Amsterdam", countryCode: "NL", timezone: "Europe/Amsterdam", airportCode: null, location: { latitude: 52.3676, longitude: 4.9041 } },
  { placeId: "synthetic-ams", kind: "airport", name: "Amsterdam Schiphol", countryCode: "NL", timezone: "Europe/Amsterdam", airportCode: "AMS", location: { latitude: 52.3105, longitude: 4.7683 } },
  { placeId: "synthetic-japan", kind: "country", name: "Japan", countryCode: "JP", timezone: "Asia/Tokyo", airportCode: null, location: null },
  { placeId: "synthetic-south-korea", kind: "country", name: "South Korea", countryCode: "KR", timezone: "Asia/Seoul", airportCode: null, location: null },
  { placeId: "synthetic-tokyo", kind: "city", name: "Tokyo", countryCode: "JP", timezone: "Asia/Tokyo", airportCode: null, location: { latitude: 35.6762, longitude: 139.6503 } },
  { placeId: "synthetic-kyoto", kind: "city", name: "Kyoto", countryCode: "JP", timezone: "Asia/Tokyo", airportCode: null, location: { latitude: 35.0116, longitude: 135.7681 } },
  { placeId: "synthetic-seoul", kind: "city", name: "Seoul", countryCode: "KR", timezone: "Asia/Seoul", airportCode: null, location: { latitude: 37.5665, longitude: 126.978 } },
];

export function createPlaceLookupProvider(mode: "deterministic" | "live"): PlaceLookupProvider {
  return {
    async search(input) {
      if (mode !== "deterministic") throw new ProblemError({ status: 503, code: "place_lookup_unavailable",
        title: "Place lookup is currently unavailable" });
      return syntheticPlaces.filter((place) => place.name.toLowerCase().includes(input.query.toLowerCase()));
    },
  };
}
