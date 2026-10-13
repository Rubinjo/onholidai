import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getApplication } from "@/server/application";
import { getSession } from "@/server/auth/auth";
import { SetupForm } from "@/components/trip-setup/setup-form";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function NewTripPage() {
  const application = getApplication();
  if (!await getSession(application.auth, await headers())) redirect("/sign-in");
  return <main className="planning-page"><h1>Plan your holiday</h1><p>Configure and review an estimated draft before accepting it.</p><SetupForm /></main>;
}
