"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { planningError, planningJson } from "@/components/trip-setup/http";
export function BookingContinuation({ intentId, returnPath }: { intentId: string; returnPath: string }) {
  const requestId = useRef<string | null>(null), router = useRouter(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<{ nextPath: string; reason?: string } | null>(null);
  async function complete() {
    requestId.current ??= crypto.randomUUID(); setBusy(true); setError("");
    try {
      const linked = z.object({ nextPath: z.string(), reason: z.string().optional() }).parse(
        await planningJson(`/api/v1/booking-intents/${intentId}/link`, { requestId: requestId.current }));
      setResult(linked); router.refresh();
    } catch (failure) { setError(planningError(failure)); } finally { setBusy(false); }
  }
  return <section className="auth-form"><h1>{result ? "Your trip is linked to your account" : "Continue with your saved trip"}</h1>
    <p>Link only this selected trip to your account. Your accepted plan and history are preserved. This does not book or pay for anything.</p>
    {result ? <><p role="status">{result.reason ? "Your current plan needs finalization before booking review." : "Your account can now review current live terms."}</p>
      <Button asChild><Link href={result.nextPath}>{result.reason ? "Return to your trip" : "Review booking terms"}</Link></Button></>
      : <Button disabled={busy} onClick={() => void complete()}>{busy ? "Linking your trip…" : error ? "Retry linking this trip" : "Link this trip and continue"}</Button>}
    <p role="alert">{error}</p><Link href={returnPath}>Back to planning</Link>
  </section>;
}
