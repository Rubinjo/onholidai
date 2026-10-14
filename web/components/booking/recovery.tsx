"use client";

import { useState } from "react";
import { planningJson } from "@/components/trip-setup/http";

export function BookingRecovery({ bookingId, componentId }: { bookingId: string; componentId: string }) {
  const [message, setMessage] = useState<string | null>(null), [busy, setBusy] = useState(false);
  async function reconcile() {
    setBusy(true);
    try {
      await planningJson(`/api/v1/bookings/${bookingId}/components/${componentId}/recovery`, {
        requestId: crypto.randomUUID(), action: "status_check", authorizationId: null,
      });
      setMessage("Status check requested. No provider booking was repeated.");
    } catch { setMessage("Status check could not be requested. Contact support before retrying a booking."); }
    finally { setBusy(false); }
  }
  return <div><button type="button" disabled={busy} onClick={() => void reconcile()}>{busy ? "Checking…" : "Check provider status"}</button>
    {message && <p role="status">{message}</p>}</div>;
}
