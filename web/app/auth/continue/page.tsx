import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getApplication } from "@/server/application";
import { planningContext } from "@/server/api";
import { continuationReference } from "@/server/auth/continuation-reference";
import { BookingContinuation } from "@/components/auth/booking-continuation";
export const dynamic = "force-dynamic";
export default async function ContinuePage({ searchParams }: { searchParams: Promise<{ intentId?: string }> }) {
  const { intentId } = await searchParams, application = getApplication();
  if (!intentId) return <main className="auth-page"><h1>Choose a trip to continue</h1><Link href="/trips/new">Start a new plan</Link></main>;
  const request = new Request(application.config.BETTER_AUTH_URL, { headers: await headers() });
  const context = await planningContext(application, request);
  if (!context.identity.accountUserId) redirect(`/sign-in?intentId=${encodeURIComponent(intentId)}`);
  try {
    const reference = await continuationReference(application.database, context.identity, intentId);
    return <main className="auth-page"><BookingContinuation intentId={intentId} returnPath={reference.returnPath} /></main>;
  } catch { return <main className="auth-page"><h1>Private continuation unavailable</h1><p>Return to the browser where you planned the trip. Signing in alone does not claim guest plans.</p><Link href="/trips/new">Start a new plan</Link></main>; }
}
