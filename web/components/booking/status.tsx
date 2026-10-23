"use client";

import { useEffect, useState } from "react";


import { planningJson } from "@/components/trip-setup/http";
import { publicBookingStatusSchema } from "@/domain/booking/public";
import { tripEnvelopeSchema } from "@/components/trip-workspace/use-trip";

import { BookingRecovery } from "./recovery";
import { RescheduleReview } from "./reschedule";
import { CancellationReview } from "./cancellation";
import { bookingComponentLabel } from "./terms-review";

import type { z } from "zod";
import type { CustomerSnapshot } from "@/domain/pricing/projections";

type Component = CustomerSnapshot["components"][number];
const statusSchema = publicBookingStatusSchema;
type BookingStatusView = z.infer<typeof statusSchema>;

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
        const next = statusSchema.parse(await planningJson(`/api/v1/bookings/${bookingId}`));
        if (active) {
          setBooking(next);
          setError(false);
          const trip = tripEnvelopeSchema.parse(await planningJson(`/api/v1/trips/${next.tripId}`));
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
                .then(async () =>
                  setBooking(
                    statusSchema.parse(await planningJson(`/api/v1/bookings/${bookingId}`)),
                  ),
                )
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
          {booking.termsVersion === 2 && booking.executionStatus === "invalidated" && (
            <p>
              Whole-trip provider execution is not activated. No services were attempted under this
              review-only booking record.
            </p>
          )}
          <ul>
            {booking.components.map((component) => (
              <li key={component.componentId}>
                {currentComponents.find((entry) => entry.id === component.componentId)
                  ? bookingComponentLabel(
                      currentComponents.find((entry) => entry.id === component.componentId)!,
                    )
                  : "Saved service"}
                : {component.status.replaceAll("_", " ")}
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
