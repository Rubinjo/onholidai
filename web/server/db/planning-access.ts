import type { Transaction } from "kysely";
import type { Database } from "./database";
import type { PlanningActor } from "@/server/auth/planning-actor";
import { planningNotFound, principalAllows } from "@/server/auth/planning-actor";
import { validPlanningSession } from "@/server/auth/planning-session";

// Compose inside the caller's transaction: session -> principal -> draft -> trip -> run.
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
