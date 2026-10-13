"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { tripKey } from "./use-trip";
export function useTripEvents(tripId: string) {
  const client = useQueryClient();
  useEffect(() => {
    const stream = new EventSource(`/api/v1/trips/${tripId}/events`);
    stream.addEventListener("trip.version.committed", () => { void client.invalidateQueries({ queryKey: tripKey(tripId) }); });
    return () => stream.close();
  }, [client, tripId]);
}
