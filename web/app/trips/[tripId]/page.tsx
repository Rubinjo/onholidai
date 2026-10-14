import { headers } from "next/headers";
import Link from "next/link";
import { z } from "zod";
import { getApplication } from "@/server/application";
import { planningContext } from "@/server/api";
import { resourceActor } from "@/server/auth/planning-resource";
import { lockPlanningAccess, lockPlanningTrip } from "@/server/db/planning-access";
import { inTransaction } from "@/server/db/transaction";
import { ProblemError } from "@/server/errors";
import { readTrip } from "@/domain/trip/read";
import { ProposalRepository } from "@/server/db/proposal-repository";
import { EstimateSummary } from "@/components/trip-workspace/estimate-summary";
import { Workspace } from "@/components/trip-workspace/workspace";
export const dynamic = "force-dynamic";
export default async function TripPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ runId?: string }> }) {
  const application = getApplication(), { tripId } = await params;
  const request = new Request(new URL(`/trips/${encodeURIComponent(tripId)}`, application.config.BETTER_AUTH_URL), { headers: await headers() });
  try {
    z.uuid().parse(tripId);
    const actor = await resourceActor(application.database, (await planningContext(application, request)).identity, "trip", tripId);
    const selected = z.uuid().safeParse((await searchParams).runId);
    const data = await inTransaction(application.database, async (transaction) => {
      await lockPlanningAccess(transaction, actor); await lockPlanningTrip(transaction, actor.planningOwnerId, tripId);
      const trip = await readTrip(transaction, actor.planningOwnerId, tripId);
      const proposalRow = await transaction.selectFrom("changeProposals").select("id").where("tripId", "=", tripId)
        .where("appliedVersion", "=", trip.version).where("status", "=", "applied").executeTakeFirst();
      const proposal = proposalRow ? await new ProposalRepository(transaction).read(actor.planningOwnerId, tripId, proposalRow.id) : null;
      const latestRun = await transaction.selectFrom("agentRuns").select("id").where("tripId", "=", tripId)
        .where("ownerUserId", "=", actor.planningOwnerId).orderBy("startedAt", "desc").limit(1).executeTakeFirst();
      const requestedRun = selected.success ? await transaction.selectFrom("agentRuns").select("id").where("id", "=", selected.data)
        .where("tripId", "=", tripId).where("ownerUserId", "=", actor.planningOwnerId).executeTakeFirst() : undefined;
      const draft = await transaction.selectFrom("setupDrafts").select("researchRequestId").where("submittedTripId", "=", tripId).executeTakeFirst();
      return { trip, proposal, runId: requestedRun?.id ?? latestRun?.id ?? null, researchRequestId: draft?.researchRequestId };
    });
    if (data.trip.snapshot.components.length) return <Workspace initialTrip={data.trip} initialRunId={data.runId} />;
    return <EstimateSummary initialTrip={data.trip} initialProposal={data.proposal} initialRunId={data.runId} initialResearchRequestId={data.researchRequestId} />;
  } catch (failure) {
    if (!(failure instanceof z.ZodError) && !(failure instanceof ProblemError && [401, 403, 404].includes(failure.status))) throw failure;
    return <main className="planning-page"><h1>Private plan unavailable</h1><p>Guest access needs the same browser and an active planning session. If you linked the trip, sign in to its account. Accepted history is not deleted when guest access expires.</p>
      <Link href="/sign-in">Sign in to your account</Link><p><Link href="/trips/new">Start a new plan</Link></p></main>;
  }
}
