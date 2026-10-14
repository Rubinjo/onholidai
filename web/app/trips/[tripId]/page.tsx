import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getApplication } from "@/server/application";
import { getSession } from "@/server/auth/auth";
import { readTrip } from "@/domain/trip/read";
import { ProposalRepository } from "@/server/db/proposal-repository";
import { EstimateSummary } from "@/components/trip-workspace/estimate-summary";
import { Workspace } from "@/components/trip-workspace/workspace";
export const dynamic = "force-dynamic";
export default async function TripPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ runId?: string }> }) {
  const application = getApplication(), session = await getSession(application.auth, await headers());
  if (!session) redirect("/sign-in");
  const { tripId } = await params, trip = await readTrip(application.database, session.user.id, tripId);
  const proposalRow = await application.database.selectFrom("changeProposals").select("id").where("tripId", "=", tripId)
    .where("appliedVersion", "=", trip.version).where("status", "=", "applied").executeTakeFirst();
  const proposal = proposalRow ? await new ProposalRepository(application.database).read(session.user.id, tripId, proposalRow.id) : null;
  const run = await application.database.selectFrom("agentRuns").select("id").where("tripId", "=", tripId)
    .where("ownerUserId", "=", session.user.id).orderBy("startedAt", "desc").limit(1).executeTakeFirst();
  const selected = z.uuid().safeParse((await searchParams).runId);
  // The page shell (including the `planning-workspace` layout class) lives inside the
  // view components so the same DOM is produced whether the workspace is reached by a
  // reload or by accepting a draft in place, avoiding a broken transition layout.
  if (trip.snapshot.components.length) return <Workspace initialTrip={trip} initialRunId={selected.success ? selected.data : run?.id ?? null} />;
  return <EstimateSummary initialTrip={trip} initialProposal={proposal}
    initialRunId={selected.success ? selected.data : proposal ? null : run?.id ?? null} />;
}
