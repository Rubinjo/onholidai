"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { planningJson, PlanningRequestError } from "@/components/trip-setup/http";

import { tripKey } from "./use-trip";

export function useTripEvents(tripId: string) {
  const client = useQueryClient();
  useEffect(() => {
    const stream = new EventSource(`/api/v1/trips/${tripId}/events`);
    const recovery = new AbortController();
    let stopped = false;
    stream.onerror = () => {
      if (stopped) return;
      void planningJson(`/api/v1/trips/${tripId}`, undefined, undefined, recovery.signal).catch(
        (error: unknown) => {
          if (
            !stopped &&
            error instanceof PlanningRequestError &&
            [401, 403, 404].includes(error.status)
          ) {
            stream.close();
            void client.invalidateQueries({ queryKey: tripKey(tripId) });
          }
        },
      );
    };
    stream.addEventListener("trip.version.committed", () => {
      if (!stopped) void client.invalidateQueries({ queryKey: tripKey(tripId) });
    });
    return () => {
      stopped = true;
      recovery.abort();
      stream.close();
    };
  }, [client, tripId]);
}
