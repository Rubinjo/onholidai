"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { customerSnapshotSchema } from "@/domain/trip/proposal";
import type { TripSnapshot } from "@/domain/trip/schema";
import { Destinations } from "./destinations";
import { Availability } from "./availability";
import { PartyPreferences } from "./party-preferences";
import { Constraints } from "./constraints";
import { DestinationPicker } from "@/components/map/destination-picker";
import { planningError, planningJson } from "./http";

export function SetupForm() {
  const router = useRouter(), errorRef = useRef<HTMLParagraphElement>(null);
  const [requestId] = useState(() => crypto.randomUUID()), [researchId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState("My holiday"), [currency, setCurrency] = useState("EUR");
  const [origin, setOrigin] = useState<TripSnapshot["departureOrigin"] | null>(null);
  const [destinations, setDestinations] = useState<TripSnapshot["destinations"]>([]);
  const [windows, setWindows] = useState<TripSnapshot["availabilityWindows"]>(() => [{ id: crypto.randomUUID(), startDate: "", endDate: "", preference: "preferred", timezone: "Europe/Amsterdam" }]);
  const [duration, setDuration] = useState({ minimumDays: 5, idealDays: 7, maximumDays: 8 });
  const [party, setParty] = useState<TripSnapshot["travellerParty"]>({ adults: 2, children: [] });
  const [preferences, setPreferences] = useState({ pace: 50, spend: 50, discovery: 50, independence: 50, setting: 50 });
  const [constraints, setConstraints] = useState<TripSnapshot["constraints"]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      if (!origin) throw new Error("Confirm a departure city or airport before requesting an estimate.");
      const snapshot = customerSnapshotSchema.parse({ departureOrigin: origin, destinations, availabilityWindows: windows,
        duration, travellerParty: party, preferences, constraints, itineraryDays: [], components: [], warnings: [],
        price: { currency, finalCustomerMinor: 0, taxesMinor: 0, feesMinor: 0, status: "estimated", checkedAt: null } });
      const trip = z.object({ tripId: z.uuid(), version: z.number().int().positive() }).passthrough().parse(
        await planningJson("/api/v1/trips", { requestId, title, currency, snapshot }));
      const result = await planningJson(`/api/v1/trips/${trip.tripId}/agent-runs`, {
        requestId: researchId, baseTripVersion: trip.version, conversationId: null,
        message: "Estimate my reviewed trip settings. Do not apply anything until I explicitly accept.", purpose: "initial_estimate" });
      const run = z.object({ id: z.uuid() }).passthrough().parse(result);
      router.push(`/trips/${trip.tripId}?runId=${run.id}`);
    } catch (failure) {
      setError(failure instanceof z.ZodError ? `Check ${failure.issues[0]?.path.join(" → ") ?? "trip settings"}: ${failure.issues[0]?.message}`
        : failure instanceof Error && failure.message.startsWith("Confirm") ? failure.message : planningError(failure));
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
    <p ref={errorRef} tabIndex={-1} role="alert">{error}</p><fieldset disabled={busy}><legend>Trip setup</legend>
      <label>Trip title<input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Presentation currency<select value={currency} onChange={(event) => setCurrency(event.target.value)}><option>EUR</option><option>GBP</option><option>USD</option><option>JPY</option></select></label>
      <Destinations origin={origin} destinations={destinations} onOrigin={setOrigin} onDestinations={setDestinations} />
      <DestinationPicker destinations={destinations} />
      <Availability windows={windows} duration={duration} onWindows={setWindows} onDuration={setDuration} />
      <PartyPreferences party={party} preferences={preferences} onParty={setParty} onPreferences={setPreferences} />
      <Constraints constraints={constraints} onChange={setConstraints} />
      <p>Research only: nothing is reserved, paid or applied. You will review and explicitly accept an estimated draft.</p>
      <button type="submit">Create trip and research estimate</button>
    </fieldset><p role="status">{busy ? "Saving your setup and starting read-only research…" : ""}</p>
  </form>;
}
