"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import type { TripEnvelope } from "@/components/trip-workspace/use-trip";

export function BookingDemo({ trip, children }: { trip: TripEnvelope; children: ReactNode }) {
  const [stage, setStage] = useState<"review" | "processing" | "complete">("review");
  const [acknowledged, setAcknowledged] = useState(false);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const completeHeading = useRef<HTMLHeadingElement>(null);
  const money = new Intl.NumberFormat("en", {
    style: "currency",
    currency: trip.snapshot.price.currency,
  });
  const total = money.format(
    trip.snapshot.price.finalCustomerMinor /
      10 ** (money.resolvedOptions().maximumFractionDigits ?? 2),
  );
  const hasTrip = trip.snapshot.destinations.length > 0 || trip.snapshot.components.length > 0;
  useEffect(() => {
    if (stage === "complete") completeHeading.current?.focus();
    if (stage !== "processing") return;
    const timer = window.setTimeout(() => setStage("complete"), 1800);
    return () => window.clearTimeout(timer);
  }, [stage]);
  return (
    <main className="booking-page planning-page booking-demo">
      <h1 ref={reviewHeading} tabIndex={-1}>
        Review booking
      </h1>
      <section className="booking-demo__notice" aria-labelledby="booking-demo-heading">
        <h2 id="booking-demo-heading">Booking demo</h2>
        <p>
          No reservations or payments will be made. This preview runs only in your browser and does
          not check live availability or booking terms.
        </p>
        <p>Leaving or reloading this page resets the demo. Existing bookings stay unchanged.</p>
      </section>
      {children}
      <section className="booking-demo__checkout" aria-labelledby="demo-checkout-heading">
        <h2 id="demo-checkout-heading">Your booking preview</h2>
        <dl className="booking-demo__total">
          <dt>Illustrative total</dt>
          <dd>{total}</dd>
        </dl>
        <p>The saved planning estimate is shown for the demo, not a verified checkout price.</p>
        {!trip.snapshot.components.length && (
          <p>No supplier services have been selected. This is an itinerary-only preview.</p>
        )}
        {stage === "review" && (
          <>
            {!hasTrip && <p>Add a destination to your trip before previewing booking.</p>}
            <label className="booking-demo__consent">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.currentTarget.checked)}
              />
              I understand this is a demo. No booking or payment will be made.
            </label>
            <Button
              type="button"
              disabled={!acknowledged || !hasTrip}
              onClick={() => setStage("processing")}
            >
              Book this trip
            </Button>
            <p>No card, passport or other personal details are needed.</p>
          </>
        )}
        <div role="status">
          {stage === "processing" && (
            <>
              <p className="booking-demo__progress">Preparing your demo confirmation…</p>
              <p>This is simulated processing. No supplier is being contacted.</p>
            </>
          )}
        </div>
        {stage === "complete" && (
          <section aria-labelledby="demo-complete-heading" className="booking-demo__confirmation">
            <h3 id="demo-complete-heading" tabIndex={-1} ref={completeHeading}>
              Demo booking complete
            </h3>
            <dl>
              <dt>Demo reference</dt>
              <dd>DEMO-{trip.tripId.slice(0, 8).toUpperCase()}</dd>
            </dl>
            <p>No real reservation was made. No payment was taken.</p>
            <p>Your saved trip is unchanged. No confirmation email has been sent.</p>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setAcknowledged(false);
                setStage("review");
                reviewHeading.current?.focus();
              }}
            >
              Preview again
            </Button>
          </section>
        )}
      </section>
      <p>
        <Link href={`/trips/${trip.tripId}`} prefetch={false}>
          Back to your trip
        </Link>
      </p>
    </main>
  );
}
