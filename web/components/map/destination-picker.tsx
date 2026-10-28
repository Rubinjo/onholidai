"use client";
import { EstimateMap } from "./estimate-map";
import { DestinationGlobe } from "./destination-globe";

import type { TripSnapshot } from "@/domain/trip/schema";
import type { PlaceCandidate } from "@/domain/trip/destination";

export function DestinationPicker({
  destinations,
  candidates,
  focusedPlace,
  onCountry,
  onCity,
}: {
  destinations: TripSnapshot["destinations"];
  candidates?: readonly PlaceCandidate[];
  focusedPlace?: PlaceCandidate | null;
  onCountry?: (code: string, name: string) => void;
  onCity?: (place: PlaceCandidate) => void;
}) {
  return onCountry ? (
    <DestinationGlobe
      destinations={destinations}
      candidates={candidates}
      focusedPlace={focusedPlace}
      onCountry={onCountry}
      onCity={onCity}
    />
  ) : (
    <EstimateMap destinations={destinations} />
  );
}
