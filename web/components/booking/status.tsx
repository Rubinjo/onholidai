"use client";

import { useEffect, useState } from "react";

import { planningJson } from "@/components/trip-setup/http";

import { BookingRecovery } from "./recovery";
import { RescheduleReview } from "./reschedule";
import { CancellationReview } from "./cancellation";

import type { CustomerSnapshot } from "@/domain/pricing/projections";

type Component = CustomerSnapshot["components"][number];
interface BookingStatusView {
  id: string;
  tripId: string;
  status: string;
  components: Array<{
    componentId: string;
    status: string;
    providerReference: string | null;
    safeReason?: string | null;
  }>;
  currentTripVersion: number;
}

export function BookingStatus({
  bookingId,
  tripComponents,
  allowComponentActions = true,
}: {
  bookingId: string;
  tripComponents: Component[];
  allowComponentActions?: boolean;
}) {
  const [booking, setBooking] = useState<BookingStatusView | null>(null),
    [error, setError] = useState(false);
  const [currentComponents, setCurrentComponents] = useState(tripComponents);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const next = (await planningJson(`/api/v1/bookings/${bookingId}`)) as BookingStatusView;
        if (active) {
          setBooking(next);
          setError(false);
          const trip = (await planningJson(`/api/v1/trips/${next.tripId}`)) as {
            version: number;
            snapshot: { components: Component[] };
          };
          if (active && trip.version >= next.currentTripVersion)
            setCurrentComponents(trip.snapshot.components);
        }
      } catch {
        if (active) setError(true);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [bookingId]);
  return (
    <section aria-labelledby="booking-status-heading" aria-live="polite">
      <h2 id="booking-status-heading">Booking progress</h2>
      {error && (
        <p role="alert">
          Could not refresh booking status. Your booking workflow was not restarted.{" "}
          <button
            type="button"
            onClick={() =>
              void planningJson(`/api/v1/bookings/${bookingId}`)
                .then((value) => setBooking(value as BookingStatusView))
                .catch(() => setError(true))
            }
          >
            Retry status
          </button>
        </p>
      )}
      {booking && (
        <>
          <p>Status: {booking.status}</p>
          <ul>
            {booking.components.map((component) => (
              <li key={component.componentId}>
                {component.componentId}: {component.status}
                {component.providerReference ? ` — reference ${component.providerReference}` : ""}
                {component.safeReason && ` — ${component.safeReason}`}
                {(component.status === "unknown" || component.status === "action_required") && (
                  <BookingRecovery bookingId={bookingId} componentId={component.componentId} />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {allowComponentActions &&
        booking &&
        booking.components
          .filter((item) => item.status === "confirmed")
          .map((item) => {
            const component = currentComponents.find(
              (candidate) => candidate.id === item.componentId,
            );
            return component ? (
              <RescheduleReview
                key={item.componentId}
                bookingId={bookingId}
                component={component}
                tripVersion={booking.currentTripVersion}
              />
            ) : null;
          })}
      {allowComponentActions &&
        booking &&
        booking.components
          .filter((item) => item.status === "confirmed")
          .map((item) => {
            const component = currentComponents.find(
              (candidate) => candidate.id === item.componentId,
            );
            return component ? (
              <CancellationReview
                key={`cancel-${item.componentId}`}
                bookingId={bookingId}
                tripId={booking.tripId}
                tripVersion={booking.currentTripVersion}
                component={component}
                tripComponents={currentComponents}
              />
            ) : null;
          })}
    </section>
  );
}
