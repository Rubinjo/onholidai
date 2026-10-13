"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { z } from "zod";
import { planningJson, planningError } from "@/components/trip-setup/http";
import type { TripEnvelope } from "./use-trip";
import { customerSnapshotSchema } from "@/domain/trip/proposal";
const historySchema = z.object({ items: z.array(z.object({ version: z.number(), initiatingRequestId: z.string(), affectedFacts: z.array(z.string()), reversible: z.boolean(), snapshot: customerSnapshotSchema }).passthrough()) });
export function VersionHistory({ trip, onCommit }: { trip: TripEnvelope; onCommit: (raw: unknown) => void }) {
  const query = useQuery({ queryKey: ["history", trip.tripId, trip.version], queryFn: async () => historySchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/versions`)) });
  const [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function undo(targetVersion: number) {
    setError(""); setBusy(true);
    try { onCommit(await planningJson(`/api/v1/trips/${trip.tripId}/commands/undo`, { requestId: crypto.randomUUID(), expectedVersion: trip.version, restoreVersion: targetVersion })); }
    catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  return <section data-trip-version={trip.version}><h2>Version history</h2><p role="alert">{error || (query.error ? "History unavailable; retry." : "")}</p>
    <button type="button" onClick={() => void query.refetch()}>Refresh history</button>
    <ol>{query.data?.items.slice().reverse().map((entry) => <li key={entry.version}><details><summary>Version {entry.version}: {entry.affectedFacts.join(", ")}</summary><p>Request {entry.initiatingRequestId}. {entry.reversible ? "Reversible draft change" : "Cannot reverse this version as a draft edit"}</p>
      <p>Route: {entry.snapshot.destinations.map((destination) => `${destination.name}, ${destination.plannedNights} nights`).join("; ")}. Party: {entry.snapshot.travellerParty.adults} adults, {entry.snapshot.travellerParty.children.length} children.</p>
      <p>Estimated total: {entry.snapshot.price.finalCustomerMinor} minor units {entry.snapshot.price.currency}.</p>
      {entry.version === trip.version && entry.version > 1 && entry.reversible && <button type="button" disabled={busy} onClick={() => void undo(entry.version - 1)}>Undo latest draft change</button>}</details></li>)}</ol>
  </section>;
}
