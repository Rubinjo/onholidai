"use client";
import { EstimateMap } from "./estimate-map";
import { DestinationGlobe } from "./destination-globe";
import type { TripSnapshot } from "@/domain/trip/schema";
import type { PlaceCandidate } from "@/domain/trip/destination";
export function DestinationPicker({ destinations, candidates, onCountry, onCity }: {
  destinations: TripSnapshot["destinations"]; candidates?: readonly PlaceCandidate[];
  onCountry?: (code: string, name: string) => void; onCity?: (place: PlaceCandidate) => void;
}) {
  return onCountry ? <DestinationGlobe destinations={destinations} candidates={candidates} onCountry={onCountry} onCity={onCity} />
    : <EstimateMap destinations={destinations} />;
}
