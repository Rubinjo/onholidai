import { headers } from "next/headers";
import Link from "next/link";

import { AuthForm } from "@/components/auth/auth-form";
import { BrandLink } from "@/components/brand-link";
import { getApplication } from "@/server/application";
import { planningContext } from "@/server/api";
import { continuationReference } from "@/server/auth/continuation-reference";

export const dynamic = "force-dynamic";
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ intentId?: string; redirectTo?: string }>;
}) {
  const params = await searchParams,
    application = getApplication();
  let returnPath = "/trips/new";
  if (params.intentId) {
    const request = new Request(application.config.BETTER_AUTH_URL, { headers: await headers() });
    try {
      returnPath = (
        await continuationReference(
          application.database,
          (await planningContext(application, request)).identity,
          params.intentId,
        )
      ).returnPath;
    } catch {
      return (
        <main className="auth-page">
          <h1>Private continuation unavailable</h1>
          <p>Return to the browser where you planned this trip, or start a new plan.</p>
          <Link href="/trips/new">Start a new plan</Link>
        </main>
      );
    }
  }
  return (
    <main className="auth-page">
      <BrandLink />
      <AuthForm
        mode="sign-up"
        intentId={params.intentId}
        redirectTo={params.redirectTo}
        returnPath={returnPath}
      />
    </main>
  );
}
