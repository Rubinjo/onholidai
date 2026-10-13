"use client";
import { EstimateMap } from "./estimate-map";
import type { TripSnapshot } from "@/domain/trip/schema";
export function DestinationPicker({ destinations }: { destinations: TripSnapshot["destinations"] }) {
  return <><p>Use the labelled search and ordered list to select, replace or reorder destinations. The map is optional.</p><EstimateMap destinations={destinations} /></>;
}
