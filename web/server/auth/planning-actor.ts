import { planningProblems } from "@/server/errors";

import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";

export type PlanningIdentity = { accountUserId: string | null; guestSessionId: string | null };
export type PlanningActor =
  | { kind: "account"; accountUserId: string; planningOwnerId: string }
  | { kind: "guest"; guestSessionId: string; planningOwnerId: string };
export type BookingActor = { accountUserId: string; planningOwnerId: string };
export function principalAllows(principal: PlanningIdentity, proof: PlanningIdentity): boolean {
  return principal.accountUserId !== null
    ? principal.accountUserId === proof.accountUserId
    : principal.guestSessionId !== null && principal.guestSessionId === proof.guestSessionId;
}
export function planningNotFound(): never {
  throw planningProblems.resourceNotFound();
}
export async function resolvePlanningActor(
  database: Kysely<Database>,
  planningOwnerId: string,
  identity: PlanningIdentity,
): Promise<PlanningActor> {
  const principal = await database
    .selectFrom("planningPrincipals")
    .selectAll()
    .where("id", "=", planningOwnerId)
    .executeTakeFirst();
  if (!principal || !principalAllows(principal, identity)) planningNotFound();
  if (principal.accountUserId !== null)
    return { kind: "account", planningOwnerId, accountUserId: principal.accountUserId };
  const session = await database
    .selectFrom("guestPlanningSessions")
    .select(["expiresAt", "revokedAt"])
    .where("id", "=", principal.guestSessionId!)
    .executeTakeFirst();
  if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) planningNotFound();
  return { kind: "guest", planningOwnerId, guestSessionId: principal.guestSessionId! };
}
export async function resolveBookingActor(
  database: Kysely<Database>,
  tripId: string,
  accountUserId: string,
): Promise<BookingActor> {
  const trip = await database
    .selectFrom("trips")
    .innerJoin("planningPrincipals", "planningPrincipals.id", "trips.ownerUserId")
    .select("trips.ownerUserId")
    .where("trips.id", "=", tripId)
    .where("planningPrincipals.accountUserId", "=", accountUserId)
    .executeTakeFirst();
  if (!trip) planningNotFound();
  return { accountUserId, planningOwnerId: trip.ownerUserId };
}
