"use client";
import { useState } from "react";
import type { TripEnvelope } from "./use-trip";
import { planningJson, planningError } from "@/components/trip-setup/http";
import { z } from "zod";
import { EditImpact, editImpactReviewSchema as reviewSchema } from "./edit-impact";
import { Destinations } from "@/components/trip-setup/destinations";
import { Availability } from "@/components/trip-setup/availability";
import { PartyPreferences } from "@/components/trip-setup/party-preferences";
import { Constraints } from "@/components/trip-setup/constraints";
import { tripEnvelopeSchema } from "./use-trip";
export function TripEditor({ trip, onCommit }: { trip: TripEnvelope; onCommit: (raw: unknown) => void }) {
  const [review, setReview] = useState<z.infer<typeof reviewSchema> | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [command, setCommand] = useState<{ requestId: string; expectedVersion: number; operations: { operation: string; target: string; value: unknown }[] } | null>(null);
  const [draft, setDraft] = useState(trip.snapshot);
  const [editingBase, setEditingBase] = useState(trip);
  async function preview() {
    setBusy(true); setError(""); setReview(null);
    try {
      const keys = ["departureOrigin", "destinations", "availabilityWindows", "duration", "travellerParty", "preferences", "constraints"] as const;
      const operations = keys.flatMap((key) => {
        const value = draft[key];
        return JSON.stringify(value) === JSON.stringify(editingBase.snapshot[key]) ? [] : [{ operation: "replace", target: `/${key}`, value }];
      });
      const input = { requestId: crypto.randomUUID(), expectedVersion: editingBase.version, operations };
      setCommand(input); setReview(reviewSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/commands/edit-preview`, input)));
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  async function apply() {
    if (!review || !command) return; setBusy(true); setError("");
    try {
      const result = tripEnvelopeSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/commands/edit`, { ...command, impactFingerprint: review.impactFingerprint }));
      onCommit(result); setEditingBase(result); setDraft(result.snapshot); setReview(null);
    }
    catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  return <section aria-labelledby="details-heading" data-trip-version={trip.version}><h2 id="details-heading">Trip details</h2><p>Committed version {trip.version}. Edits require impact review.</p>
    <p>Saved travellers: {trip.snapshot.travellerParty.adults} adults; child ages at trip start: {trip.snapshot.travellerParty.children.map((child) => child.ageAtTripStart).join(", ") || "none"}.</p>
    {editingBase.version !== trip.version && <p role="alert">The trip changed while you were editing. Your unsaved inputs are preserved. Reload current details before making a new review.</p>}
    <button type="button" disabled={busy} onClick={() => { setEditingBase(trip); setDraft(trip.snapshot); setReview(null); setCommand(null); }}>Reload current trip details</button>
    <form onSubmit={(event) => { event.preventDefault(); void preview(); }}><fieldset disabled={busy}><legend>Edit draft settings</legend>
      <Destinations origin={draft.departureOrigin} destinations={draft.destinations} onOrigin={(departureOrigin) => setDraft({ ...draft, departureOrigin })} onDestinations={(destinations) => setDraft({ ...draft, destinations: destinations.map((entry) => ({ ...entry, arrivalDate: null, departureDate: null, plannedNights: 0 })) })} />
      <Availability windows={draft.availabilityWindows} duration={draft.duration} onWindows={(availabilityWindows) => setDraft({ ...draft, availabilityWindows })} onDuration={(duration) => setDraft({ ...draft, duration })} />
      <PartyPreferences party={draft.travellerParty} preferences={draft.preferences} onParty={(travellerParty) => setDraft({ ...draft, travellerParty })} onPreferences={(preferences) => setDraft({ ...draft, preferences })} />
      <Constraints constraints={draft.constraints} onChange={(constraints) => setDraft({ ...draft, constraints })} />
      <button type="submit" disabled={editingBase.version !== trip.version}>Review edit impacts</button></fieldset></form><p role="alert">{error}</p>
    {review && <EditImpact review={review} version={trip.version} busy={busy} onAccept={() => void apply()} onDiscard={() => setReview(null)} />}
  </section>;
}
