"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import { planningJson, planningError } from "@/components/trip-setup/http";
import { Button } from "@/components/ui/button";
import {
  bookingReviewStateSchema,
  type BookingReviewState,
  type PublicBookingTransaction,
} from "@/domain/booking/public";

import { bookingComponentLabel, TermsReview } from "./terms-review";
import { AuthorizationForm } from "./authorization-form";
import { BookingStatus } from "./status";

import type { CustomerSnapshot } from "@/domain/pricing/projections";

type Component = CustomerSnapshot["components"][number];

const acceptedSchema = z
  .object({
    workflowId: z.string().min(1),
    status: z.enum(["accepted", "running", "completed", "failed"]),
  })
  .strict();

export function BookingConsole({
  tripId,
  tripVersion,
  components,
}: {
  tripId: string;
  tripVersion: number;
  components: Component[];
}) {
  const [state, setState] = useState<BookingReviewState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [started, setStarted] = useState<PublicBookingTransaction | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const submissionErrorSummary = useRef<HTMLParagraphElement>(null);
  const pendingReview = useRef<{ requestId: string; expectedVersion: number } | null>(null);
  useEffect(() => {
    if (submissionError) submissionErrorSummary.current?.focus();
  }, [submissionError]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const next = bookingReviewStateSchema.parse(
          await planningJson(
            `/api/v1/trips/${tripId}/bookings`,
            undefined,
            undefined,
            abort.signal,
          ),
        );
        if (!abort.signal.aborted) {
          setState(next);
          if (next.tripVersion !== tripVersion) setStale(true);
          setError(null);
        }
      } catch (cause) {
        if (!abort.signal.aborted) setError(planningError(cause));
      } finally {
        polling = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    const stream =
      typeof EventSource === "function" ? new EventSource(`/api/v1/trips/${tripId}/events`) : null;
    stream?.addEventListener("trip.version.committed", (event) => {
      if (abort.signal.aborted) return;
      try {
        if (!(event instanceof MessageEvent)) throw new Error("Invalid trip event");
        const update = z
          .object({
            tripId: z.uuid(),
            version: z.number().int().positive(),
            reloadRequired: z.boolean(),
          })
          .strict()
          .parse(JSON.parse(String(event.data)));
        if (update.tripId !== tripId) throw new Error("Wrong trip event");
        if (update.version > tripVersion) setStale(true);
        void poll();
      } catch {
        setStale(true);
        setError("Trip updates could not be verified. Refresh this page before authorizing.");
      }
    });
    return () => {
      abort.abort();
      stream?.close();
      window.clearInterval(timer);
    };
  }, [tripId, tripVersion, refresh]);
  async function revalidate() {
    setBusy(true);
    setSubmissionError(null);
    try {
      pendingReview.current ??= {
        requestId: crypto.randomUUID(),
        expectedVersion: tripVersion,
      };
      acceptedSchema.parse(
        await planningJson(`/api/v1/trips/${tripId}/booking/revalidations`, pendingReview.current),
      );
      pendingReview.current = null;
      setRefresh((value) => value + 1);
    } catch (cause) {
      setSubmissionError(planningError(cause));
    } finally {
      setBusy(false);
    }
  }
  const review = state?.review;
  const attempt = started ?? state?.activeAttempt ?? state?.latestAttempt;
  const expired = Boolean(review?.expiresAt && Date.parse(review.expiresAt) <= now);
  const eligible =
    state?.tripVersion === tripVersion &&
    !stale &&
    !error &&
    !submissionError &&
    !expired &&
    review?.status === "completed" &&
    review.tripVersion === tripVersion &&
    review.terms?.schemaVersion === 2 &&
    review.terms.tripVersion === tripVersion &&
    state.coverage.eligible &&
    review.terms.coverage?.eligible &&
    review.terms.components
      .filter((component) => component.disposition === "to_book")
      .every(
        (component) =>
          Date.parse(component.expiresAt) > now &&
          component.prerequisites.travellers === "ready" &&
          component.prerequisites.payment === "ready",
      );
  return (
    <section aria-labelledby="current-booking-review">
      <h2 id="current-booking-review">Current whole-trip review</h2>
      <p>
        Nothing is reserved or paid for by reviewing this page. Booking needs verified final terms,
        trusted traveller and payment readiness, and separate exact whole-trip authorization.
      </p>
      {!state && !error && <p role="status">Restoring saved review and booking attempts…</p>}
      {stale && (
        <p role="alert">
          Your trip changed. Refresh this page to review the current complete trip.
        </p>
      )}
      {state?.coverage.issues.length ? (
        <section aria-labelledby="booking-blockers">
          <h3 id="booking-blockers">Resolve before booking</h3>
          <ul>
            {state.coverage.issues.map((issue, index) => (
              <li key={`${issue.code}:${index}`}>{issue.message}</li>
            ))}
          </ul>
          <p>
            Planning acknowledgements do not resolve missing or unverified booking requirements.
          </p>
        </section>
      ) : null}
      {state?.coverage.entries.some((entry) => entry.state === "not_required") && (
        <p>
          Verified informational or free items are included in your trip but do not require a
          booking.
        </p>
      )}
      {!attempt && (
        <Button type="button" disabled={busy || !state || stale} onClick={() => void revalidate()}>
          {busy ? "Checking live terms…" : "Revalidate availability and price"}
        </Button>
      )}
      {review?.status === "accepted" || review?.status === "running" ? (
        <p role="status">Checking live price and availability…</p>
      ) : null}
      {review?.status === "failed" && (
        <p role="alert">
          Some required services could not be verified. Do not authorize this trip yet.
        </p>
      )}
      {!review?.terms &&
        review?.outcomes.some(
          (outcome) => outcome.outcome === "unknown" || outcome.outcome === "unavailable",
        ) && (
          <section aria-labelledby="booking-service-checks">
            <h3 id="booking-service-checks">Services needing verification</h3>
            <ul>
              {review.outcomes
                .filter(
                  (outcome) => outcome.outcome === "unknown" || outcome.outcome === "unavailable",
                )
                .map((outcome) => {
                  const component = components.find((entry) => entry.id === outcome.componentId);
                  return (
                    <li key={outcome.componentId}>
                      {component
                        ? `${bookingComponentLabel(component)} (${component.provider})`
                        : "Required service"}
                      :{" "}
                      {outcome.safeReason ??
                        "Required final terms or trusted prerequisites remain unverified."}
                    </li>
                  );
                })}
            </ul>
          </section>
        )}
      {expired && (
        <p role="alert">
          These booking terms expired. Revalidate the whole trip before authorizing.
        </p>
      )}
      {review?.terms && (
        <TermsReview terms={review.terms} outcomes={review.outcomes} estimates={components} />
      )}
      {attempt ? (
        <BookingStatus
          bookingId={attempt.id}
          tripComponents={components}
          allowComponentActions={attempt.termsVersion === 1}
        />
      ) : eligible && review?.terms && review.termsHash && review.expiresAt ? (
        <AuthorizationForm
          key={review.termsHash}
          tripId={tripId}
          tripVersion={tripVersion}
          terms={review.terms}
          termsHash={review.termsHash}
          expiresAt={review.expiresAt}
          authorization={state?.authorization ?? null}
          onStarted={(booking) => {
            setStarted(booking);
            setRefresh((value) => value + 1);
          }}
        />
      ) : null}
      {state?.confirmedCommitments.length ? (
        <section aria-labelledby="saved-commitments">
          <h3 id="saved-commitments">Saved confirmed commitments</h3>
          <ul>
            {state.confirmedCommitments.map((commitment) => (
              <li key={commitment.id}>
                {components.find((component) => component.id === commitment.componentId)?.type ??
                  "Saved service"}
                : {commitment.serviceStart} to {commitment.serviceEnd}. Reference{" "}
                {commitment.providerReference}. This commitment is not a new charge or booking.
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {error && <p role="alert">{error}</p>}
      {submissionError && (
        <p role="alert" tabIndex={-1} ref={submissionErrorSummary}>
          {submissionError}
        </p>
      )}
      {error && (
        <Button variant="ghost" onClick={() => setRefresh((value) => value + 1)}>
          Restore saved booking state
        </Button>
      )}
    </section>
  );
}
