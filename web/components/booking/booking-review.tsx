"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";

import { feasibilityReportSchema } from "@/domain/trip/feasibility";
import { tripEnvelopeSchema, type TripEnvelope } from "@/components/trip-workspace/use-trip";
import { planningError, planningJson } from "@/components/trip-setup/http";
import { Button } from "@/components/ui/button";

import { BookingConsole } from "./booking-console";
import { bookingComponentLabel } from "./terms-review";

const readinessSchema = z.object({
  version: z.number(),
  report: feasibilityReportSchema,
  reviewFingerprint: z.string(),
});
const runSchema = z.object({ id: z.uuid(), status: z.string() });
function WholeTripOverview({ trip }: { trip: TripEnvelope }) {
  const destinations = [...trip.snapshot.destinations].sort(
    (a, b) => a.routePosition - b.routePosition,
  );
  return (
    <section className="booking-overview" aria-labelledby="whole-trip-heading">
      <h2 id="whole-trip-heading">Your whole trip</h2>
      <p>
        {trip.snapshot.departureOrigin?.name ?? "Departure origin needs confirmation"} to{" "}
        {destinations.map((entry) => entry.name).join(", ")} and return.
      </p>
      <dl>
        <div>
          <dt>Dates</dt>
          <dd>
            {destinations[0]?.arrivalDate ?? "Not scheduled"} to{" "}
            {destinations.at(-1)?.departureDate ?? "Not scheduled"}
          </dd>
        </div>
        <div>
          <dt>Party</dt>
          <dd>
            {trip.snapshot.travellerParty.adults} adults
            {trip.snapshot.travellerParty.children.length
              ? `; children aged ${trip.snapshot.travellerParty.children.map((child) => child.ageAtTripStart).join(", ")}`
              : "; no children"}
          </dd>
        </div>
        <div>
          <dt>Accepted trip</dt>
          <dd>
            Version {trip.version}; {trip.snapshot.components.length} selected services
          </dd>
        </div>
      </dl>
      {trip.snapshot.components.length ? (
        <ul className="booking-overview__services">
          {trip.snapshot.components.map((component) => (
            <li key={component.id}>
              <strong>{bookingComponentLabel(component)}</strong>
              <p>
                {component.provider}; {component.serviceStart} to {component.serviceEnd};{" "}
                {component.travellerIds.length} travellers;{" "}
                {component.bookingStatus.replaceAll("_", " ")}.
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          No paid travel, stay or activity services have been selected. Missing requirements must be
          resolved before booking.
        </p>
      )}
    </section>
  );
}
export function BookingReview({ initialTrip }: { initialTrip: TripEnvelope }) {
  const [trip, setTrip] = useState(initialTrip),
    [readiness, setReadiness] = useState<z.infer<typeof readinessSchema> | null>(null);
  const [acknowledged, setAcknowledged] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const request = useRef<{
    requestId: string;
    expectedVersion: number;
    acknowledgeUnverified: boolean;
    reviewFingerprint: string;
  } | null>(null);
  const research = useRef<{
    requestId: string;
    baseTripVersion: number;
    purpose: "finalization";
    applicationPolicy: "automatic";
    message: string;
  } | null>(null);
  const basePath = `/api/v1/trips/${trip.tripId}`;
  useEffect(() => {
    if (trip.lifecycleState !== "draft") return;
    let active = true;
    void planningJson(`${basePath}/commands/finalize`)
      .then((value) => {
        if (active) {
          setReadiness(readinessSchema.parse(value));
          setAcknowledged(false);
          request.current = null;
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(planningError(cause));
      });
    return () => {
      active = false;
    };
  }, [basePath, trip.version, trip.lifecycleState]);
  useEffect(() => {
    if (!runId) return;
    let active = true;
    async function poll() {
      try {
        const run = runSchema.parse(await planningJson(`/api/v1/agent-runs/${runId}`));
        if (!active || ["queued", "running"].includes(run.status)) return;
        const next = tripEnvelopeSchema.parse(await planningJson(basePath));
        if (active) {
          setTrip(next);
          setRunId(null);
          setBusy(false);
          if (run.status === "failed" || !next.snapshot.itineraryDays.length)
            setError(
              "The itinerary is not ready yet. Return to your trip to resolve questions or retry preparation.",
            );
        }
      } catch (cause) {
        if (active) {
          setError(planningError(cause));
          setBusy(false);
        }
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [runId, basePath]);
  async function prepare() {
    setBusy(true);
    setError("");
    research.current ??= {
      requestId: crypto.randomUUID(),
      baseTripVersion: trip.version,
      purpose: "finalization",
      applicationPolicy: "automatic",
      message:
        "Prepare the detailed itinerary for booking review. Do not book or pay for anything.",
    };
    try {
      const run = runSchema.parse(await planningJson(`${basePath}/agent-runs`, research.current));
      setRunId(run.id);
      research.current = null;
    } catch (cause) {
      setError(planningError(cause));
      setBusy(false);
    }
  }
  async function continueReview() {
    if (!readiness) return;
    setBusy(true);
    setError("");
    request.current ??= {
      requestId: crypto.randomUUID(),
      expectedVersion: readiness.version,
      acknowledgeUnverified: acknowledged,
      reviewFingerprint: readiness.reviewFingerprint,
    };
    try {
      setTrip(
        tripEnvelopeSchema.parse(
          await planningJson(`${basePath}/commands/finalize`, request.current),
        ),
      );
      request.current = null;
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      setBusy(false);
    }
  }
  if (trip.lifecycleState !== "draft")
    return (
      <main className="booking-page planning-page">
        <h1>Review booking</h1>
        <WholeTripOverview trip={trip} />
        <BookingConsole
          tripId={trip.tripId}
          tripVersion={trip.version}
          components={trip.snapshot.components}
        />
        <p>
          <Link href={`/trips/${trip.tripId}`}>Back to your trip</Link>
        </p>
      </main>
    );
  const requiresAcknowledgement = Boolean(
    readiness && (readiness.report.unverified.length || readiness.report.exceptions.length),
  );
  return (
    <main className="booking-page planning-page">
      <h1>Review booking</h1>
      <p>
        Check your itinerary here, then review live availability, prices and booking terms. Nothing
        is reserved or paid for without your separate authorization.
      </p>
      <WholeTripOverview trip={trip} />
      <section className="booking-readiness" aria-labelledby="readiness-heading">
        <h2 id="readiness-heading">Your itinerary before booking</h2>
        <p>Reviewing trip version {trip.version}.</p>
        {!trip.snapshot.itineraryDays.length && (
          <>
            <p>A detailed daily itinerary is needed to check timing and travel connections.</p>
            <Button disabled={busy} onClick={() => void prepare()}>
              Prepare itinerary for review
            </Button>
          </>
        )}
        {readiness ? (
          <>
            {readiness.report.blocking.length > 0 && (
              <>
                <h3>Resolve before booking</h3>
                <ul>
                  {readiness.report.blocking.map((issue, index) => (
                    <li key={index}>{issue.message}</li>
                  ))}
                </ul>
              </>
            )}
            {requiresAcknowledgement && (
              <>
                <h3>Conditions to review</h3>
                <ul>
                  {[...readiness.report.unverified, ...readiness.report.exceptions].map(
                    (issue, index) => (
                      <li key={index}>{issue.message}</li>
                    ),
                  )}
                </ul>
                <label>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => {
                      setAcknowledged(event.target.checked);
                      request.current = null;
                    }}
                  />
                  I have reviewed these unverified conditions and planning exceptions
                </label>
              </>
            )}
            <Button
              disabled={
                busy ||
                readiness.version !== trip.version ||
                Boolean(readiness.report.blocking.length) ||
                (requiresAcknowledgement && !acknowledged)
              }
              onClick={() => void continueReview()}
            >
              Continue to live terms
            </Button>
          </>
        ) : (
          <p>Checking itinerary readiness…</p>
        )}
        <p role="status">{busy ? "Preparing your booking review…" : ""}</p>
        <p role="alert">{error}</p>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={async () => {
            try {
              setTrip(tripEnvelopeSchema.parse(await planningJson(basePath)));
              setReadiness(
                readinessSchema.parse(await planningJson(`${basePath}/commands/finalize`)),
              );
              setAcknowledged(false);
              request.current = null;
              setError("");
            } catch (cause) {
              setError(planningError(cause));
            }
          }}
        >
          Refresh review
        </Button>
        <p>
          <Link href={`/trips/${trip.tripId}`}>Back to your trip</Link>
        </p>
      </section>
    </main>
  );
}
