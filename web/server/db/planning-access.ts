import type { Transaction } from "kysely";
import type { Database } from "./database";
import type { PlanningActor } from "@/server/auth/planning-actor";
import { planningNotFound, principalAllows } from "@/server/auth/planning-actor";
import { validPlanningSession } from "@/server/auth/planning-session";

// Compose inside the caller's transaction, in this order:
// guest session/quota guard (when applicable) -> principal -> draft -> trip -> run.
export async function lockPlanningAccess(transaction: Transaction<Database>, actor: PlanningActor, now = new Date()): Promise<void> {
  if (actor.kind === "guest") {
    const session = await transaction.selectFrom("guestPlanningSessions").selectAll()
      .where("id", "=", actor.guestSessionId).forUpdate().executeTakeFirst();
    if (!session || !validPlanningSession(session, now)) planningNotFound();
  }
  const principal = await transaction.selectFrom("planningPrincipals").selectAll().where("id", "=", actor.planningOwnerId)
    .forUpdate().executeTakeFirst();
  const identity = actor.kind === "account" ? { accountUserId: actor.accountUserId, guestSessionId: null }
    : { accountUserId: null, guestSessionId: actor.guestSessionId };
  if (!principal || !principalAllows(principal, identity)) planningNotFound();
}

// Owner-scoped draft lock for the step after lockPlanningAccess. The draft id is a
// resource reference only; the principal row decides authority.
export async function lockSetupDraft(transaction: Transaction<Database>, planningOwnerId: string, draftId: string) {
  const draft = await transaction.selectFrom("setupDrafts").selectAll().where("id", "=", draftId).forUpdate().executeTakeFirst();
  if (!draft || draft.planningOwnerId !== planningOwnerId) planningNotFound();
  return draft;
}

// Owner-scoped trip lock for private planning reads and mutations.
export async function lockPlanningTrip(transaction: Transaction<Database>, planningOwnerId: string, tripId: string) {
  const trip = await transaction.selectFrom("trips").selectAll().where("id", "=", tripId).forUpdate().executeTakeFirst();
  if (!trip || trip.ownerUserId !== planningOwnerId) planningNotFound();
  return trip;
}
