"use client";
import { EstimateMap } from "./estimate-map";
import type { TripEnvelope } from "@/components/trip-workspace/use-trip";
import { useMemo } from "react";
export function ItineraryMap({ trip }: { trip: TripEnvelope }) {
  const segments = useMemo(() => trip.snapshot.itineraryDays.flatMap((day) => day.items.flatMap((item) => item.travelSegment ? [item.travelSegment] : [])), [trip.snapshot.itineraryDays]);
  return <div data-trip-version={trip.version}><EstimateMap destinations={trip.snapshot.destinations} segments={segments} /></div>;
}
