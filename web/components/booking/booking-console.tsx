"use client";

import { useEffect, useState } from "react";

import { planningJson, planningError } from "@/components/trip-setup/http";

import { TermsReview } from "./terms-review";
import { AuthorizationForm } from "./authorization-form";
import { BookingStatus } from "./status";

import type { PublicBookingTerms } from "@/domain/booking/authorization";
import type { CustomerSnapshot } from "@/domain/pricing/projections";

type Component = CustomerSnapshot["components"][number];

interface RevalidationView {
  workflowId: string;
  status: string;
  outcomes: Array<{ componentId: string; outcome: string; safeReason?: string }>;
  termsHash: string | null;
  terms: PublicBookingTerms | null;
  expiresAt: string | null;
}

export function BookingConsole({
  tripId,
  tripVersion,
  components,
}: {
  tripId: string;
  tripVersion: number;
  components: Component[];
}) {
  const [workflowId, setWorkflowId] = useState<string | null>(null),
    [review, setReview] = useState<RevalidationView | null>(null);
  const [reviewedAt, setReviewedAt] = useState<number | null>(null);
  const [bookingId, setBookingId] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!workflowId) return;
    let active = true;
    const poll = async () => {
      try {
        const next = (await planningJson(
          `/api/v1/booking/revalidations/${workflowId}`,
        )) as RevalidationView;
        if (active) {
          setReview(next);
          setReviewedAt(Date.now());
          setError(null);
        }
      } catch (cause) {
        if (active) setError(planningError(cause));
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [workflowId]);
  async function revalidate() {
    setBusy(true);
    setError(null);
    try {
      const result = (await planningJson(`/api/v1/trips/${tripId}/booking/revalidations`, {
        requestId: crypto.randomUUID(),
        expectedVersion: tripVersion,
      })) as { workflowId: string };
      setWorkflowId(result.workflowId);
      setReview(null);
      setReviewedAt(null);
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="booking-page">
      <h1>Review booking</h1>
      <p>
        Booking requires current live terms and your explicit authorization. This will not reserve
        anything until you authorize the displayed terms.
      </p>
      {!review && (
        <button type="button" disabled={busy} onClick={() => void revalidate()}>
          {busy ? "Checking live terms…" : "Revalidate availability and price"}
        </button>
      )}
      {review?.status === "accepted" || review?.status === "running" ? (
        <p role="status">Checking live price and availability…</p>
      ) : null}
      {review?.status === "failed" && (
        <>
          <p role="alert">Some components could not be verified. Do not authorize this trip yet.</p>
          <button type="button" disabled={busy} onClick={() => void revalidate()}>
            Check again
          </button>
        </>
      )}
      {review?.status === "completed" &&
        review.terms &&
        review.termsHash &&
        review.expiresAt &&
        reviewedAt !== null &&
        Date.parse(review.expiresAt) > reviewedAt && (
          <>
            <TermsReview terms={review.terms} outcomes={review.outcomes} />
            {bookingId ? (
              <BookingStatus bookingId={bookingId} tripComponents={components} />
            ) : (
              <AuthorizationForm
                tripId={tripId}
                tripVersion={tripVersion}
                terms={review.terms}
                termsHash={review.termsHash}
                onStarted={(booking) => setBookingId(booking.id)}
              />
            )}
          </>
        )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
