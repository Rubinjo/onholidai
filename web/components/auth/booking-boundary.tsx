"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/ui/use-hydrated";
import { planningError, planningJson, PlanningRequestError } from "@/components/trip-setup/http";
export function BookingBoundary({ tripId }: { tripId: string }) {
  const ready = useHydrated();
  const requestId = useRef<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [intent, setIntent] = useState<{ signInPath: string; signUpPath: string } | null>(null);
  async function prepare(choice: "sign-in" | "sign-up") {
    requestId.current ??= crypto.randomUUID(); setBusy(true); setError("");
    try {
      const result = await planningJson("/api/v1/booking-intents", { requestId: requestId.current, tripId });
      const account = z.object({ nextPath: z.string() }).safeParse(result);
      if (account.success) { window.location.assign(account.data.nextPath); return; }
      const continuation = z.object({ signInPath: z.string(), signUpPath: z.string() }).parse(result);
      setIntent(continuation); window.location.assign(choice === "sign-in" ? continuation.signInPath : continuation.signUpPath);
    } catch (failure) {
      if (failure instanceof PlanningRequestError && failure.code === "booking_intent_expired") requestId.current = null;
      setError(planningError(failure));
    } finally { setBusy(false); }
  }
  return <section className="booking-boundary" aria-busy={!ready || busy}><h1>Keep this trip when you enter booking</h1>
    <p>Sign in or create a free account to associate booking review and confirmations with you. Your trip and accepted history stay intact.</p>
    <p>No subscription or payment information is required to register. Signing in and linking your trip do not authorize a reservation or payment.</p>
    {!intent && <div className="setup-actions"><Button disabled={!ready || busy} onClick={() => void prepare("sign-in")}>Sign in</Button>
      <Button variant="outline" disabled={!ready || busy} onClick={() => void prepare("sign-up")}>Create a free account</Button></div>}
    {intent && <div className="setup-actions"><Button asChild><Link href={intent.signInPath}>Sign in</Link></Button><Button variant="outline" asChild><Link href={intent.signUpPath}>Create a free account</Link></Button></div>}
    <p role="status">{!ready ? "Opening account options…" : busy ? "Preparing your private booking continuation…" : ""}</p><p role="alert">{error}</p><Link href={`/trips/${tripId}`}>Back to planning</Link>
  </section>;
}
