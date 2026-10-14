import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getApplication } from "@/server/application";
import { getSession } from "@/server/auth/auth";
import { readTrip } from "@/domain/trip/read";
import { BookingConsole } from "@/components/booking/booking-console";

export const dynamic = "force-dynamic";
export default async function BookingPage({ params }: { params: Promise<{ tripId: string }> }) {
  const application = getApplication(), session = await getSession(application.auth, await headers());
  if (!session) redirect("/sign-in");
  const { tripId } = await params, trip = await readTrip(application.database, session.user.id, tripId);
  if (!(["finalized", "partially_booked", "booked"] as string[]).includes(trip.lifecycleState)) redirect(`/trips/${tripId}`);
  return <BookingConsole tripId={tripId} tripVersion={trip.version} components={trip.snapshot.components} />;
}
