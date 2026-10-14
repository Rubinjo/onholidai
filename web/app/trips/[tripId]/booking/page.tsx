import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getApplication } from "@/server/application";
import { planningContext } from "@/server/api";
import { resourceActor } from "@/server/auth/planning-resource";
import { lockPlanningAccess, lockPlanningTrip } from "@/server/db/planning-access";
import { inTransaction } from "@/server/db/transaction";
import { readTrip } from "@/domain/trip/read";
import { BookingConsole } from "@/components/booking/booking-console";
import { BookingBoundary } from "@/components/auth/booking-boundary";
import { ProblemError } from "@/server/errors";
import { z } from "zod";
export const dynamic = "force-dynamic";
export default async function BookingPage({ params }: { params: Promise<{ tripId: string }> }) {
  const application = getApplication(), { tripId } = await params;
  let data;
  try {
    z.uuid().parse(tripId);
    const request = new Request(application.config.BETTER_AUTH_URL, { headers: await headers() });
    const actor = await resourceActor(application.database, (await planningContext(application, request)).identity, "trip", tripId);
    data = await inTransaction(application.database, async (transaction) => {
      await lockPlanningAccess(transaction, actor); await lockPlanningTrip(transaction, actor.planningOwnerId, tripId);
      return { actor, trip: await readTrip(transaction, actor.planningOwnerId, tripId) };
    });
  } catch (failure) {
    if (!(failure instanceof z.ZodError) && !(failure instanceof ProblemError && [401, 403, 404].includes(failure.status))) throw failure;
    return <main className="planning-page"><h1>Private plan unavailable</h1><Link href="/sign-in">Sign in to your account</Link></main>;
  }
  if (!["finalized", "partially_booked", "booked"].includes(data.trip.lifecycleState) || !data.trip.snapshot.components.length) redirect(`/trips/${tripId}`);
  if (data.actor.kind === "guest") return <main className="auth-page"><BookingBoundary tripId={tripId} /></main>;
  return <BookingConsole tripId={tripId} tripVersion={data.trip.version} components={data.trip.snapshot.components} />;
}
