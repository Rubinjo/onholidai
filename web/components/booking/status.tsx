"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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

const attemptLabels: Record<BookingStatusView["status"], string> = {
  requested: "Booking requested",
  running: "Booking in progress",
  partially_confirmed: "Some services are confirmed",
  confirmed: "All services are confirmed",
  action_required: "Some services need attention",
  failed: "No services were confirmed",
  cancelled: "Booking cancelled",
};
const componentLabels: Record<BookingStatusView["components"][number]["status"], string> = {
  proposed: "Awaiting authorization",
  authorized: "Waiting to be booked",
  not_attempted: "Not attempted; no booking was sent",
  booking: "Booking in progress",
  confirmed: "Confirmed",
  failed: "Not booked; supplier reported failure",
  unknown: "Outcome uncertain; do not repeat this booking",
  action_required: "Needs attention; contact booking support",
  cancelled: "Cancelled",
};

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
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true,
      pending = false;
    const controller = new AbortController();
    const poll = async () => {
      if (pending) return;
      pending = true;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]);
      try {
        const next = statusSchema.parse(
          await planningJson(`/api/v1/bookings/${bookingId}`, undefined, undefined, signal),
        );
        if (next.id !== bookingId) throw new Error("Booking status identity mismatch");
        if (active) {
          setBooking(next);
          setError(false);
          const trip = tripEnvelopeSchema.parse(
            await planningJson(`/api/v1/trips/${next.tripId}`, undefined, undefined, signal),
          );
          if (active && trip.version >= next.currentTripVersion)
            setCurrentComponents(trip.snapshot.components);
        }
      } catch {
        if (active) setError(true);
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [bookingId, refresh]);
  return (
    <section aria-labelledby="booking-status-heading" aria-live="polite">
      <h2 id="booking-status-heading">Booking progress</h2>
      {error && (
        <p role="alert">
          Could not refresh booking status. Your booking workflow was not restarted.{" "}
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            Retry status
          </button>
        </p>
      )}
      {booking && (
        <>
          <p>{attemptLabels[booking.status]}</p>
          {booking.continuationOf && (
            <p>
              This continues booking attempt {booking.continuationOf}. Original attempt:{" "}
              {booking.rootAttemptId}. Saved confirmations belong to the same recovery history.
            </p>
          )}
          {booking.termsVersion === 2 &&
            booking.executionStatus === "invalidated" &&
            booking.components.length > 0 &&
            booking.components.every(
              (component) =>
                component.status === "not_attempted" &&
                component.safeReason?.includes("Whole-trip provider execution is not activated"),
            ) && (
              <p>
                Whole-trip provider execution is not activated. No services were attempted under
                this review-only booking record.
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
                : {componentLabels[component.status]}
                {component.providerReference ? ` — reference ${component.providerReference}` : ""}
                {component.safeReason && ` — ${component.safeReason}`}
                {(component.status === "unknown" || component.status === "action_required") && (
                  <BookingRecovery bookingId={bookingId} componentId={component.componentId} />
                )}
              </li>
            ))}
          </ul>
          {booking.components.some((component) =>
            ["unknown", "action_required"].includes(component.status),
          ) && (
            <p>
              Quote booking attempt {booking.id} and any saved supplier reference when contacting
              booking support. Existing confirmations are preserved. Do not repeat a service with an
              uncertain outcome.
            </p>
          )}
          <p>
            <Link href={`/trips/${booking.tripId}`}>Return to your saved trip</Link>
          </p>
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
