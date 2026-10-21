import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { BrandLink } from "@/components/brand-link";
import { AuthForm } from "@/components/auth/auth-form";
import { getApplication } from "@/server/application";
import { getSession, signOut } from "@/server/auth/auth";
import { planningContext } from "@/server/api";
import { continuationReference } from "@/server/auth/continuation-reference";
import { safeAuthDestination } from "@/components/auth/safe-destination";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
async function signOutAction() {
  "use server";
  await signOut(getApplication().auth, await headers()); redirect("/sign-in");
}
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ intentId?: string; redirectTo?: string }> }) {
  const params = await searchParams, application = getApplication(), requestHeaders = await headers();
  const session = await getSession(application.auth, requestHeaders);
  let returnPath = "/trips/new";
  if (params.intentId) {
    try { returnPath = (await continuationReference(application.database,
      (await planningContext(application, new Request(application.config.BETTER_AUTH_URL, { headers: requestHeaders }))).identity, params.intentId)).returnPath; }
    catch { return <main className="auth-page"><h1>Private continuation unavailable</h1><p>Use the same browser where you planned this trip.</p><Link href="/trips/new">Start a new plan</Link></main>; }
    if (session) redirect(safeAuthDestination(params.intentId));
  }
  return <main className="auth-page"><BrandLink />{session ? <section className="auth-form"><h1>You are signed in</h1>
    <p>{session.user.email}</p><form action={signOutAction}><Button type="submit" variant="outline">Sign out</Button></form><Link href="/trips/new">Plan a holiday</Link></section>
    : <AuthForm mode="sign-in" intentId={params.intentId} redirectTo={params.redirectTo} returnPath={returnPath} />}</main>;
}
