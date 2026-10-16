"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { feasibilityReportSchema } from "@/domain/trip/feasibility";
import { planningError, planningJson } from "@/components/trip-setup/http";
import type { TripEnvelope } from "./use-trip";
import { Button } from "@/components/ui/button";
const reviewSchema = z.object({ tripId: z.uuid(), version: z.number().int().positive(), report: feasibilityReportSchema,
  reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export function FinalizationReview({ trip, onCommit }: { trip: TripEnvelope; onCommit: (raw: unknown) => void }) {
  const [review, setReview] = useState<z.infer<typeof reviewSchema> | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [outcome, setOutcome] = useState("");
  const requestId = useRef(crypto.randomUUID());
  async function load() {
    setBusy(true); setError(""); setAcknowledged(false);
    try { setReview(reviewSchema.parse(await planningJson(`/api/v1/trips/${trip.tripId}/commands/finalize`))); requestId.current = crypto.randomUUID(); }
    catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  async function finalize() {
    if (!review) return;
    setBusy(true); setError("");
    try {
      onCommit(await planningJson(`/api/v1/trips/${trip.tripId}/commands/finalize`, { requestId: requestId.current,
        expectedVersion: review.version, reviewFingerprint: review.reviewFingerprint, acknowledgeUnverified: acknowledged }));
      setOutcome("Planning itinerary finalized; bookings remain unconfirmed."); setReview(null);
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  return <section data-trip-version={trip.version}><h2>Finalization review</h2>
    <p role="status">{outcome || (trip.lifecycleState === "finalized" ? "Planning itinerary finalized; bookings remain unconfirmed." : "Review the saved planning version before finalization.")}</p>
    <Button variant="secondary" disabled={busy || trip.lifecycleState !== "draft"} onClick={() => void load()}>Review finalization</Button>
    <p role="alert">{error}</p>{review && <><p>Review of version {review.version}, feasibility policy {review.report.policyVersion}. Verified items: {review.report.verifiedItems}/{review.report.totalItems}.</p>
      {review.version !== trip.version && <p role="alert">The trip changed. Review finalization again.</p>}
      <section aria-label="Blocking conflicts"><h3>Blocking conflicts</h3><ul>{review.report.blocking.map((entry, index) => <li key={index}>{entry.message}</li>)}</ul>{!review.report.blocking.length && <p>No known blocking conflicts.</p>}</section>
      <section aria-label="Unverified conditions"><h3>Unverified conditions</h3><ul>{review.report.unverified.map((entry, index) => <li key={index}>{entry.message}</li>)}</ul></section>
      <section aria-label="Planning exceptions"><h3>Planning exceptions</h3><ul>{review.report.exceptions.map((entry, index) => <li key={index}>{entry.message}</li>)}</ul></section>
      <h3>Suggested moves or removals</h3><ul>{review.report.suggestions.map((entry, index) => <li key={index}>{entry.action} item {entry.itemId}: {entry.reason} Request <q>Remove activity {entry.itemId}</q> or <q>Move activity {entry.itemId} to YYYY-MM-DD at HH:MM</q> in the conversation for a reviewed change.</li>)}</ul>
      <p>Use trip details or request a revised proposal to resolve conflicts. Suggestions preserve your choices until you explicitly accept changes.</p>
      <label><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />I have reviewed the unverified conditions and planning exceptions</label>
      <Button disabled={busy || trip.lifecycleState !== "draft" || review.version !== trip.version || Boolean(review.report.blocking.length)
        || Boolean((review.report.unverified.length || review.report.exceptions.length) && !acknowledged)} onClick={() => void finalize()}>Finalize planning itinerary</Button>
      <p>This finalizes planning only. Reservations and payments require a separate booking review.</p>
    </>}
  </section>;
}
