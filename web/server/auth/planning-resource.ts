import type { Kysely, Transaction } from "kysely";
import type { Database } from "@/server/db/database";
import { lockPlanningAccess, lockPlanningTrip } from "@/server/db/planning-access";
import { planningNotFound, resolvePlanningActor, type PlanningActor, type PlanningIdentity } from "./planning-actor";
import { planningProblems } from "@/server/errors";
import type { ServiceTokenContext } from "@/server/agent-client/credentials";

export async function resourceActor(database: Kysely<Database>, identity: PlanningIdentity, kind: "trip" | "run", id: string): Promise<PlanningActor> {
  const resource = kind === "trip" ? await database.selectFrom("trips").select("ownerUserId").where("id", "=", id).executeTakeFirst()
    : await database.selectFrom("agentRuns").select("ownerUserId").where("id", "=", id).executeTakeFirst();
  if (!resource) planningNotFound();
  return resolvePlanningActor(database, resource.ownerUserId, identity);
}
export async function lockServiceGrant(transaction: Transaction<Database>, context: ServiceTokenContext): Promise<void> {
  const principal = await transaction.selectFrom("planningPrincipals").selectAll().where("id", "=", context.userId).executeTakeFirst();
  if (!principal) planningNotFound();
  const actor: PlanningActor = principal.accountUserId ? { kind: "account", accountUserId: principal.accountUserId, planningOwnerId: principal.id }
    : { kind: "guest", guestSessionId: principal.guestSessionId!, planningOwnerId: principal.id };
  await lockPlanningAccess(transaction, actor);
  await lockPlanningTrip(transaction, context.userId, context.tripId);
  const grant = await transaction.selectFrom("agentRuns").select(["id", "planningAccessRevokedAt"])
    .where("ownerUserId", "=", context.userId).where("tripId", "=", context.tripId)
    .where("requestId", "=", context.requestId).where("baseTripVersion", "=", context.baseTripVersion).forUpdate().executeTakeFirst();
  if (!grant) planningNotFound();
  if (grant.planningAccessRevokedAt) throw planningProblems.planningRunAccessRevoked();
}
