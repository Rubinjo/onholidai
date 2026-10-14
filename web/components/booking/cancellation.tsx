"use client";

import { useState } from "react";
import { planningJson, planningError } from "@/components/trip-setup/http";
import type { PublicBookingTerms } from "@/domain/booking/authorization";
import { TermsReview } from "./terms-review";
import { BookingStatus } from "./status";
import type { CustomerSnapshot } from "@/domain/pricing/projections";

type Component = CustomerSnapshot["components"][number];
type Revalidation = { workflowId: string; status: string; termsHash: string | null; terms: PublicBookingTerms | null;
  outcomes: Array<{ componentId: string; outcome: string; safeReason?: string }>; expiresAt: string | null };

export function CancellationReview({ bookingId, tripId, tripVersion, component, tripComponents }: {
  bookingId: string; tripId: string; tripVersion: number; component: Component; tripComponents: Component[];
}) {
  const [open, setOpen] = useState(false), [review, setReview] = useState<Revalidation | null>(null);
  const [nextBookingId, setNextBookingId] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  async function reviewTerms() {
    setBusy(true); setError(null);
    try {
      const started = await planningJson(`/api/v1/trips/${tripId}/booking/revalidations`, {
        requestId: crypto.randomUUID(), expectedVersion: tripVersion,
      }) as { workflowId: string };
      let current: Revalidation | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        current = await planningJson(`/api/v1/booking/revalidations/${started.workflowId}`) as Revalidation;
        if (["completed", "failed"].includes(current.status)) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      setReview(current);
      if (current?.status !== "completed" || !current.terms?.components.some((entry) => entry.componentId === component.id)) {
        setError("Cancellation terms could not be verified. Your existing booking is unchanged.");
      }
    } catch (cause) { setError(planningError(cause)); }
    finally { setBusy(false); }
  }
  async function authorizeAndCancel() {
    if (!review?.termsHash) return;
    setBusy(true); setError(null);
    try {
      const authorization = await planningJson(`/api/v1/trips/${tripId}/booking/authorizations`, {
        requestId: crypto.randomUUID(), tripVersion, termsHash: review.termsHash, operation: "cancel_component",
        componentId: component.id, acknowledgedNonReversibleActions: review.terms?.nonReversibleActions ?? [],
      }) as { id: string };
      const cancellation = await planningJson(`/api/v1/bookings/${bookingId}/components/${component.id}/cancellations`, {
        requestId: crypto.randomUUID(), authorizationId: authorization.id,
      }) as { id: string };
      setNextBookingId(cancellation.id);
    } catch (cause) { setError(planningError(cause)); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby={`cancel-${component.id}`}>
    <h3 id={`cancel-${component.id}`}>Cancel {component.type}</h3>
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>Review cancellation terms</button>
    {open && !nextBookingId && <>
      <p>This is a separate provider action. Review any cancellation cost and non-reversible terms before authorizing.</p>
      {!review && <button type="button" disabled={busy} onClick={() => void reviewTerms()}>{busy ? "Checking terms…" : "Check current cancellation terms"}</button>}
      {review?.terms && review.termsHash && <>
        <TermsReview terms={review.terms} outcomes={review.outcomes} />
        <button type="button" disabled={busy} onClick={() => void authorizeAndCancel()}>{busy ? "Submitting…" : "Authorize cancellation of this component"}</button>
      </>}
      {error && <p role="alert">{error}</p>}
    </>}
    {nextBookingId && <BookingStatus bookingId={nextBookingId} tripComponents={tripComponents} />}
  </section>;
}
