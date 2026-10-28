import { createHash } from "node:crypto";

import { countryCityCandidates } from "@/server/supply/places";

import type { PlaceCandidate } from "@/domain/trip/destination";
import type { TripSnapshot } from "@/domain/trip/schema";

type Destination = TripSnapshot["destinations"][number];

// A short break is one base; longer trips can compare two or three suitable cities.
export function automaticCityLimit(idealDays: number): number {
  if (idealDays >= 12) return 3;
  if (idealDays >= 6) return 2;
  return 1;
}

function autoDestinationId(placeId: string): string {
  const hex = createHash("sha256").update(`auto-city:${placeId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function toDestination(place: PlaceCandidate): Destination {
  return {
    id: autoDestinationId(place.placeId),
    kind: "city",
    name: place.name,
    countryCode: place.countryCode,
    timezone: place.timezone,
    providerPlaceIds: { lookup: place.placeId, ...place.providerPlaceIds },
    location: place.location,
    routePosition: 0,
    arrivalDate: null,
    departureDate: null,
    plannedNights: 0,
  };
}

/**
 * Replace country-only selections with a bounded set of sourced city stops.
 * Explicit city selections are authoritative and never expanded.
 */
export function autoSelectCities(
  destinations: readonly Destination[],
  idealDays: number,
  mode: "deterministic" | "live",
): Destination[] {
  if (destinations.some((place) => place.kind === "city")) return [...destinations];
  const limit = automaticCityLimit(idealDays);
  const result: Destination[] = [];
  for (const place of destinations) {
    if (place.kind !== "country") {
      result.push(place);
      continue;
    }
    const cities = countryCityCandidates(place.countryCode, mode, limit).map(toDestination);
    result.push(...(cities.length ? cities : [place]));
  }
  return result.slice(0, 8).map((place, routePosition) => ({ ...place, routePosition }));
}
