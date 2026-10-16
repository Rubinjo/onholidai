"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccessibleField } from "@/components/ui/accessible-field";
import { StatusAnnouncer } from "@/components/ui/status-announcer";
import { safeAuthDestination } from "./safe-destination";
import { useHydrated } from "@/components/ui/use-hydrated";

export function AuthForm({ mode, intentId, redirectTo, returnPath = "/trips/new" }: {
  mode: "sign-in" | "sign-up"; intentId?: string; redirectTo?: string; returnPath?: string;
}) {
  const router = useRouter(), errorRef = useRef<HTMLParagraphElement>(null), ready = useHydrated();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const nextPath = safeAuthDestination(intentId, redirectTo), alternate = mode === "sign-in" ? "sign-up" : "sign-in";
  const query = intentId ? `?intentId=${encodeURIComponent(intentId)}` : redirectTo ? `?redirectTo=${encodeURIComponent(safeAuthDestination(undefined, redirectTo))}` : "";
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const response = await fetch(`/api/auth/${mode}/email`, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "sign-up"
          ? { name: name.trim(), email, password, locale: "en-GB", defaultCurrency: "GBP" } : { email, password }) });
      if (!response.ok) {
        setError(mode === "sign-up" ? "Account creation did not finish. Check your fields, or sign in if you already have an account."
          : "Sign-in did not finish. Check your email and password and retry.");
        requestAnimationFrame(() => errorRef.current?.focus()); return;
      }
      // Better Auth owns password policy/storage and its protected account cookie.
      router.push(nextPath); router.refresh();
    } catch { setError("Authentication is unavailable. Retry when connected; your private plan is preserved."); requestAnimationFrame(() => errorRef.current?.focus()); }
    finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void submit(event)} className="auth-form" aria-busy={!ready || busy}>
    <h1>{mode === "sign-up" ? "Create your free account" : "Sign in"}</h1>
    <p>An account associates booking review and confirmations with you. Planning needs no account, subscription or payment information.</p>
    <p ref={errorRef} tabIndex={-1} role="alert">{error}</p><fieldset disabled={!ready || busy}><legend className="sr-only">Account details</legend>
      {mode === "sign-up" && <AccessibleField label="Name" required><Input name="name" autoComplete="name" maxLength={120} value={name} onChange={(event) => setName(event.target.value)} /></AccessibleField>}
      <AccessibleField label="Email address" required><Input name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></AccessibleField>
      <AccessibleField label="Password" required description={mode === "sign-up" ? "Use at least eight characters." : undefined}>
        <Input name="password" type="password" minLength={mode === "sign-up" ? 8 : 1} maxLength={128} autoComplete={mode === "sign-up" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
      </AccessibleField>
      <Button type="submit">{mode === "sign-up" ? "Create free account" : "Sign in"}</Button>
    </fieldset><p role="status">{busy ? "Checking your account…" : ""}</p><StatusAnnouncer message={busy ? "Authentication in progress" : error} />
    <Link href={`/${alternate}${query}`}>{mode === "sign-up" ? "Sign in instead" : "Create a free account"}</Link>
    <Link href={safeAuthDestination(undefined, returnPath)}>Back to planning</Link>
  </form>;
}
