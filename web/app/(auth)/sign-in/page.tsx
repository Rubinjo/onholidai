import { redirect } from "next/navigation";

import {
  getSession,
  signInWithEmail,
  signOut,
} from "@/server/auth/auth";

const DEFAULT_REDIRECT_PATH = "/";

function safeRedirectPath(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_REDIRECT_PATH;
  }

  try {
    const baseUrl = new URL("https://onholidai.invalid");
    const targetUrl = new URL(value, baseUrl);
    if (targetUrl.origin !== baseUrl.origin) {
      return DEFAULT_REDIRECT_PATH;
    }

    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
  } catch {
    return DEFAULT_REDIRECT_PATH;
  }
}

async function signInAction(formData: FormData) {
  "use server";

  const email = formData.get("email");
  const password = formData.get("password");
  const redirectTo = safeRedirectPath(formData.get("redirectTo")?.toString());

  if (typeof email !== "string" || typeof password !== "string") {
    redirect(`/sign-in?error=invalid-credentials&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  try {
    await signInWithEmail(email, password);
  } catch {
    redirect(`/sign-in?error=invalid-credentials&redirectTo=${encodeURIComponent(redirectTo)}`);
  }

  redirect(redirectTo);
}

async function signOutAction() {
  "use server";

  await signOut();
  redirect("/sign-in");
}

interface SignInPageProps {
  searchParams: Promise<{
    error?: string | string[];
    redirectTo?: string | string[];
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const [session, params] = await Promise.all([getSession(), searchParams]);
  const redirectTo = safeRedirectPath(params.redirectTo);
  const hasInvalidCredentials = params.error === "invalid-credentials";

  return (
    <main className="min-h-dvh bg-[#f2f0e9] text-[#18211d]">
      <div className="mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-12 px-6 py-12 lg:grid-cols-[1.1fr_0.9fr] lg:px-12">
        <section aria-labelledby="auth-heading" className="max-w-xl">
          <p className="mb-5 font-sans text-xs font-bold tracking-[0.16em] text-[#ad3f2f] uppercase">
            Onholidai
          </p>
          <h1 id="auth-heading" className="m-0 text-5xl leading-[1.05] sm:text-6xl">
            Your plans, ready when you are.
          </h1>
          <p className="mt-6 max-w-lg font-sans text-lg leading-8 text-[#46534d]">
            Sign in to continue planning, reviewing, and booking your trip.
          </p>
        </section>

        <section
          aria-label={session ? "Account" : "Sign in"}
          className="border border-[#c9cec8] bg-white p-7 shadow-[8px_8px_0_#d8a746] sm:p-9"
        >
          {session ? (
            <div className="font-sans">
              <h2 className="m-0 font-serif text-3xl">You are signed in</h2>
              <p className="mt-3 break-words text-[#46534d]">{session.user.email}</p>
              <form action={signOutAction} className="mt-8">
                <button
                  type="submit"
                  className="min-h-12 w-full cursor-pointer border-2 border-[#18211d] bg-transparent px-5 py-3 font-bold text-[#18211d] focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#ad3f2f]"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <form action={signInAction} className="font-sans">
              <h2 className="m-0 font-serif text-3xl">Sign in</h2>
              {hasInvalidCredentials ? (
                <p
                  role="alert"
                  className="mt-5 border-l-4 border-[#ad3f2f] bg-[#fff1ed] px-4 py-3 text-sm text-[#72271c]"
                >
                  We could not sign you in. Check your email and password and try again.
                </p>
              ) : null}

              <input name="redirectTo" type="hidden" value={redirectTo} />

              <label className="mt-7 block font-bold" htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                className="mt-2 min-h-12 w-full border-2 border-[#65716b] bg-white px-3 py-2 text-base focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#ad3f2f]"
              />

              <label className="mt-5 block font-bold" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="mt-2 min-h-12 w-full border-2 border-[#65716b] bg-white px-3 py-2 text-base focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#ad3f2f]"
              />

              <button
                type="submit"
                className="mt-8 min-h-12 w-full cursor-pointer border-2 border-[#18211d] bg-[#18211d] px-5 py-3 font-bold text-white focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#ad3f2f]"
              >
                Sign in
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}