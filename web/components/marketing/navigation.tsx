import Link from "next/link";
import { headers } from "next/headers";

import { BrandLink } from "@/components/brand-link";
import { Button } from "@/components/ui/button";
import { safeAuthDestination } from "@/components/auth/safe-destination";
import { getApplication } from "@/server/application";
import { getSession } from "@/server/auth/auth";
import { signOutAction } from "@/server/auth/actions";

export async function MarketingNavigation({
  returnPath,
  showPlanningLink = false,
}: { returnPath?: string; showPlanningLink?: boolean } = {}) {
  const requestHeaders = await headers();
  const session = await getSession(getApplication().auth, requestHeaders);
  const query = returnPath
    ? `?redirectTo=${encodeURIComponent(safeAuthDestination(undefined, returnPath))}`
    : "";
  return (
    <header className="marketing-nav">
      <BrandLink />
      <nav aria-label="Main navigation">
        {showPlanningLink && <Link href="/trips/new">Start planning</Link>}
        {session ? (
          <>
            <Link href="/sign-in">Account</Link>
            <form action={signOutAction}>
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          </>
        ) : (
          <>
            <Link href={`/sign-in${query}`}>Sign in</Link>
            <Button variant="outline" asChild>
              <Link href={`/sign-up${query}`}>Free sign-up</Link>
            </Button>
          </>
        )}
      </nav>
    </header>
  );
}
