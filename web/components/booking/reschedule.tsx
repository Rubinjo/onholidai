"use client";

import { useState } from "react";
import { Temporal } from "@js-temporal/polyfill";

import { planningJson, planningError } from "@/components/trip-setup/http";

import { TermsReview } from "./terms-review";
import { BookingStatus } from "./status";

import type { PublicBookingTerms } from "@/domain/booking/authorization";
import type { CustomerSnapshot } from "@/domain/pricing/projections";

type Component = CustomerSnapshot["components"][number];
type Revalidation = {
  workflowId: string;
  status: string;
  termsHash: string | null;
  terms: PublicBookingTerms | null;
  outcomes: Array<{ componentId: string; outcome: string; safeReason?: string }>;
  expiresAt: string | null;
};

export function RescheduleReview({
  bookingId,
  component,
  tripVersion,
}: {
  bookingId: string;
  component: Component;
  tripVersion: number;
}) {
  const [open, setOpen] = useState(false),
    [start, setStart] = useState(""),
    [end, setEnd] = useState("");
  const [review, setReview] = useState<Revalidation | null>(null),
    [nextBookingId, setNextBookingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function revalidate() {
    setBusy(true);
    setError(null);
    try {
      const timezone = component.planningDetails?.timezone ?? "UTC";
      const requestedChange = {
        ...(start
          ? {
              serviceStart: Temporal.PlainDateTime.from(start)
                .toZonedDateTime(timezone)
                .toInstant()
                .toString(),
            }
          : {}),
        ...(end
          ? {
              serviceEnd: Temporal.PlainDateTime.from(end)
                .toZonedDateTime(timezone)
                .toInstant()
                .toString(),
            }
          : {}),
      };
      const result = (await planningJson(
        `/api/v1/bookings/${bookingId}/components/${component.id}/reschedule-revalidations`,
        { requestId: crypto.randomUUID(), requestedChange },
      )) as { workflowId: string };
      let current: Revalidation | null = null;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        current = (await planningJson(
          `/api/v1/booking/revalidations/${result.workflowId}`,
        )) as Revalidation;
        if (["completed", "failed"].includes(current.status)) break;
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      setReview(current);
      if (!current || current.status !== "completed")
        setError("New terms could not be confirmed. Your existing booking is unchanged.");
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function authorizeAndExecute() {
    if (!review?.termsHash) return;
    setBusy(true);
    setError(null);
    try {
      const authorization = (await planningJson(
        `/api/v1/bookings/${bookingId}/components/${component.id}/reschedule-authorizations`,
        {
          requestId: crypto.randomUUID(),
          revalidationId: review.workflowId,
          tripVersion,
          termsHash: review.termsHash,
          acknowledgedNonReversibleActions: review.terms?.nonReversibleActions ?? [],
        },
      )) as { id: string };
      const result = (await planningJson(
        `/api/v1/bookings/${bookingId}/components/${component.id}/reschedules`,
        {
          requestId: crypto.randomUUID(),
          authorizationId: authorization.id,
        },
      )) as { id: string };
      setNextBookingId(result.id);
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby={`reschedule-${component.id}`}>
      <h3 id={`reschedule-${component.id}`}>Reschedule {component.type}</h3>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Review a separate rescheduling request
      </button>
      {open && !nextBookingId && (
        <>
          <p>
            Current service: {component.serviceStart} to {component.serviceEnd}. Other confirmed
            components remain unchanged.
          </p>
          <label>
            New start time ({component.planningDetails?.timezone ?? "UTC"})
            <input
              type="datetime-local"
              value={start}
              onChange={(event) => setStart(event.currentTarget.value)}
            />
          </label>
          <label>
            New end time ({component.planningDetails?.timezone ?? "UTC"})
            <input
              type="datetime-local"
              value={end}
              onChange={(event) => setEnd(event.currentTarget.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || (!start && !end)}
            onClick={() => void revalidate()}
          >
            {busy ? "Checking new terms…" : "Check new terms"}
          </button>
          {review?.status === "completed" && review.terms && review.termsHash && (
            <>
              <TermsReview terms={review.terms} outcomes={review.outcomes} />
              <button type="button" disabled={busy} onClick={() => void authorizeAndExecute()}>
                {busy ? "Starting…" : "Authorize and reschedule these exact terms"}
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
      {nextBookingId && (
        <BookingStatus
          bookingId={nextBookingId}
          tripComponents={[component]}
          allowComponentActions={false}
        />
      )}
    </section>
  );
}
