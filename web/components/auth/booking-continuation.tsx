"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { planningError, planningJson } from "@/components/trip-setup/http";
export function BookingContinuation({ intentId, returnPath }: { intentId: string; returnPath: string }) {
  const ready = useHydrated();
  const requestId = useRef<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<{ nextPath: string; reason?: string } | null>(null);
  async function complete() {
    requestId.current ??= crypto.randomUUID(); setBusy(true); setError("");
    try {
      const linked = z.object({ nextPath: z.string(), reason: z.string().optional() }).parse(
        await planningJson(`/api/v1/booking-intents/${intentId}/link`, { requestId: requestId.current }));
      // Authentication already finished before this explicit link. A refresh of
      // this page can race the traveller's next navigation (notably in WebKit).
      setResult(linked);
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  return <section className="auth-form"><h1>{result ? "Your trip is linked to your account" : "Continue with your saved trip"}</h1>
    <p>Link only this selected trip to your account. Your accepted plan and history are preserved. This does not book or pay for anything.</p>
    {result ? <><p role="status">{result.reason ? "Your current plan needs finalization before booking review." : "Your account can now review current live terms."}</p>
      <Button asChild><a href={result.nextPath}>{result.reason ? "Return to your trip" : "Review booking terms"}</a></Button></>
      : <Button disabled={!ready || busy} onClick={() => void complete()}>{!ready ? "Opening your saved trip…" : busy ? "Linking your trip…" : error ? "Retry linking this trip" : "Link this trip and continue"}</Button>}
    <p role="alert">{error}</p><Link href={returnPath}>Back to planning</Link>
  </section>;
}
