"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { planningJson, PlanningRequestError } from "@/components/trip-setup/http";

import { tripKey } from "./use-trip";

export function useTripEvents(tripId: string) {
  const client = useQueryClient();
  useEffect(() => {
    const stream = new EventSource(`/api/v1/trips/${tripId}/events`);
    let stopped = false;
    stream.onerror = () => {
      void planningJson(`/api/v1/trips/${tripId}`).catch((error: unknown) => {
        if (
          !stopped &&
          error instanceof PlanningRequestError &&
          [401, 403, 404].includes(error.status)
        ) {
          stream.close();
          void client.invalidateQueries({ queryKey: tripKey(tripId) });
        }
      });
    };
    stream.addEventListener("trip.version.committed", () => {
      void client.invalidateQueries({ queryKey: tripKey(tripId) });
    });
    return () => {
      stopped = true;
      stream.close();
    };
  }, [client, tripId]);
}
