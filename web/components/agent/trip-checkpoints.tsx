"use client";
import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { chatVersionsSchema } from "@/server/db/chat-versions-schema";
import { planningError, planningJson, PlanningRequestError } from "@/components/trip-setup/http";
import { Button } from "@/components/ui/button";
import type { TripEnvelope } from "@/components/trip-workspace/use-trip";

export function useChatVersions(tripId: string, version: number) {
  return useInfiniteQuery({ queryKey: ["chat-versions", tripId, version], initialPageParam: null as number | null, placeholderData: keepPreviousData,
    queryFn: async ({ pageParam }) => chatVersionsSchema.parse(await planningJson(`/api/v1/trips/${tripId}/versions?compact=true${pageParam ? `&beforeVersion=${pageParam}` : ""}`)),
    getNextPageParam: (page) => page.nextBeforeVersion ?? undefined });
}
export function TripCheckpoint({ entry, trip, onCommit, onStatus }: { entry: import("zod").z.infer<typeof chatVersionsSchema>["items"][number]; trip: TripEnvelope; onCommit: (raw: unknown) => void; onStatus: (text: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<{ requestId: string; expectedVersion: number; restoreVersion: number } | null>(null);
  async function restore() {
    setBusy(true); setError("");
    pending.current ??= { requestId: crypto.randomUUID(), expectedVersion: trip.version, restoreVersion: entry.version };
    try {
      onCommit(await planningJson(`/api/v1/trips/${trip.tripId}/commands/undo`, pending.current));
      pending.current = null; onStatus(`Restored version ${entry.version} as a new trip version.`);
    } catch (failure) {
      if (failure instanceof PlanningRequestError && [400, 401, 403, 404, 409, 422].includes(failure.status)) pending.current = null;
      setError(planningError(failure));
    }
    finally { setBusy(false); }
  }
  return <><p>{entry.summary.join(" ")}</p><div className="trip-checkpoint"><span>Version {entry.version}{entry.version === trip.version ? " · Current trip" : ""}</span>
    {entry.restorable && entry.version !== trip.version ? <Button variant="ghost" aria-label={`Restore trip to version ${entry.version}`} disabled={busy} onClick={() => void restore()}>{busy ? "Restoring…" : "Restore trip"}</Button>
      : entry.version !== trip.version && <span className="trip-checkpoint__reason">{entry.restoreReason}</span>}</div>
    {error && <p role="alert">{error} Refresh the conversation if this version is no longer available.</p>}</>;
}
