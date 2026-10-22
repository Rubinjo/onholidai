"use client";

import { useState } from "react";

import { planningJson, planningError } from "@/components/trip-setup/http";

import type { PublicBookingTerms } from "@/domain/booking/authorization";

export function AuthorizationForm({
  tripId,
  tripVersion,
  terms,
  termsHash,
  onStarted,
}: {
  tripId: string;
  tripVersion: number;
  terms: PublicBookingTerms;
  termsHash: string;
  onStarted: (booking: { id: string }) => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function authorize() {
    setBusy(true);
    setError(null);
    try {
      const authorization = (await planningJson(`/api/v1/trips/${tripId}/booking/authorizations`, {
        requestId: crypto.randomUUID(),
        tripVersion,
        termsHash,
        operation: "book_trip",
        componentId: null,
        acknowledgedNonReversibleActions: acknowledged ? terms.nonReversibleActions : [],
      })) as { id: string };
      const booking = (await planningJson(`/api/v1/trips/${tripId}/bookings`, {
        requestId: crypto.randomUUID(),
        authorizationId: authorization.id,
      })) as { id: string };
      onStarted(booking);
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="authorize-booking-heading">
      <h2 id="authorize-booking-heading">Authorize this booking</h2>
      {terms.nonReversibleActions.length > 0 && (
        <label>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.currentTarget.checked)}
          />
          I acknowledge the listed non-reversible actions.
        </label>
      )}
      <button
        type="button"
        disabled={busy || (terms.nonReversibleActions.length > 0 && !acknowledged)}
        onClick={() => void authorize()}
      >
        {busy ? "Starting booking…" : "Authorize and book these exact terms"}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
