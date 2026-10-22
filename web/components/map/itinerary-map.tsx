"use client";
import { useMemo } from "react";

import { EstimateMap } from "./estimate-map";

import type { TripEnvelope } from "@/components/trip-workspace/use-trip";

export function ItineraryMap({ trip, fill = false }: { trip: TripEnvelope; fill?: boolean }) {
  const segments = useMemo(
    () =>
      trip.snapshot.itineraryDays.flatMap((day) =>
        day.items.flatMap((item) => (item.travelSegment ? [item.travelSegment] : [])),
      ),
    [trip.snapshot.itineraryDays],
  );
  const activities = useMemo(
    () =>
      Object.fromEntries(
        trip.snapshot.destinations.map((destination) => [
          destination.id,
          trip.snapshot.itineraryDays
            .filter((day) => day.destinationId === destination.id)
            .flatMap((day) =>
              day.items
                .filter((item) => item.type === "activity")
                .map((item) => item.title ?? "Planned activity"),
            ),
        ]),
      ),
    [trip.snapshot.destinations, trip.snapshot.itineraryDays],
  );
  return (
    <div data-trip-version={trip.version} className="trip-workspace__map">
      <EstimateMap
        destinations={trip.snapshot.destinations}
        segments={segments}
        activities={activities}
        fill={fill}
      />
    </div>
  );
}
