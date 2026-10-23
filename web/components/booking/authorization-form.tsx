"use client";

import { useEffect, useRef, useState } from "react";

import { planningJson, planningError } from "@/components/trip-setup/http";
import { Button } from "@/components/ui/button";
import { publicAuthorizationSchema, publicBookingTransactionSchema } from "@/domain/booking/public";

import type {
  PublicBookingTerms,
  PublicBookingTransaction,
  BookingReviewState,
} from "@/domain/booking/public";

export function AuthorizationForm({
  tripId,
  tripVersion,
  terms,
  termsHash,
  expiresAt,
  authorization: savedAuthorization,
  onStarted,
}: {
  tripId: string;
  tripVersion: number;
  terms: PublicBookingTerms;
  termsHash: string;
  expiresAt: string;
  authorization?: BookingReviewState["authorization"];
  onStarted: (booking: PublicBookingTransaction) => void;
}) {
  const [acknowledged, setAcknowledged] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = useRef<{
    authorizationRequestId: string;
    startRequestId: string;
    authorizationId: string | null;
  } | null>(null);
  const inFlight = useRef(false),
    errorSummary = useRef<HTMLParagraphElement>(null);
  const [consentLocked, setConsentLocked] = useState(false);
  useEffect(() => {
    if (error) errorSummary.current?.focus();
  }, [error]);
  function assertCurrent() {
    if (
      terms.schemaVersion !== 2 ||
      !terms.coverage?.eligible ||
      terms.tripVersion !== tripVersion ||
      Date.parse(expiresAt) <= Date.now() ||
      terms.components.some(
        (component) =>
          component.disposition === "to_book" && Date.parse(component.expiresAt) <= Date.now(),
      )
    )
      throw new Error(
        "These complete-trip terms changed or expired. Refresh the whole-trip review.",
      );
  }
  async function authorize() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      assertCurrent();
      setConsentLocked(true);
      const restored =
        savedAuthorization?.status === "authorized" &&
        savedAuthorization.termsHash === termsHash &&
        savedAuthorization.tripVersion === tripVersion &&
        savedAuthorization.tripId === tripId &&
        Date.parse(savedAuthorization.expiresAt) > Date.now()
          ? savedAuthorization
          : null;
      pending.current ??= {
        authorizationRequestId: restored?.requestId ?? crypto.randomUUID(),
        startRequestId: crypto.randomUUID(),
        authorizationId: restored?.id ?? null,
      };
      const identity = pending.current;
      if (!identity.authorizationId) {
        const authorization = publicAuthorizationSchema.parse(
          await planningJson(`/api/v1/trips/${tripId}/booking/authorizations`, {
            requestId: identity.authorizationRequestId,
            tripVersion,
            termsHash,
            operation: "book_trip",
            componentId: null,
            acknowledgedNonReversibleActions: acknowledged,
          }),
        );
        if (
          authorization.tripId !== tripId ||
          authorization.tripVersion !== tripVersion ||
          authorization.termsHash !== termsHash ||
          authorization.operation !== "book_trip" ||
          authorization.componentId !== null ||
          authorization.status !== "authorized"
        )
          throw new Error(
            "The saved authorization does not match this complete review. Restore booking state.",
          );
        identity.authorizationId = authorization.id;
      }
      assertCurrent();
      const booking = publicBookingTransactionSchema.parse(
        await planningJson(`/api/v1/trips/${tripId}/bookings`, {
          requestId: identity.startRequestId,
          authorizationId: identity.authorizationId,
        }),
      );
      if (
        booking.tripId !== tripId ||
        booking.authorizationId !== identity.authorizationId ||
        booking.termsHash !== termsHash
      )
        throw new Error(
          "The booking response does not match this authorization. Restore saved booking state.",
        );
      onStarted(booking);
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="authorize-booking-heading">
      <h2 id="authorize-booking-heading">Authorize the whole trip</h2>
      <p>
        Providers may confirm services separately. Partial success is possible; we will not silently
        cancel existing commitments or retry an uncertain payment.
      </p>
      <p>
        Whole-trip provider execution is not activated yet. This action records exact authorization
        and a non-executing booking attempt, not supplier confirmations.
      </p>
      {terms.nonReversibleActions.map((id) => (
        <label key={id}>
          <input
            type="checkbox"
            disabled={busy || consentLocked}
            checked={acknowledged.includes(id)}
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setAcknowledged((values) =>
                checked ? [...values, id] : values.filter((value) => value !== id),
              );
            }}
          />
          I acknowledge that{" "}
          {terms.components.find((component) => component.componentId === id)?.service?.title ??
            "this listed service"}{" "}
          cannot be reversed under the displayed terms.
        </label>
      ))}
      <Button
        type="button"
        disabled={busy || terms.nonReversibleActions.some((id) => !acknowledged.includes(id))}
        onClick={() => void authorize()}
      >
        {busy ? "Recording whole-trip booking…" : "Authorize and start whole-trip booking"}
      </Button>
      {error && (
        <p ref={errorSummary} role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
    </section>
  );
}
