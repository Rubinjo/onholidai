import { lockPlanningAccess, lockPlanningTrip } from "@/server/db/planning-access";

import { resolveBookingActor, planningNotFound, type BookingActor } from "./planning-actor";

import type { Kysely, Transaction } from "kysely";
import type { Database } from "@/server/db/database";

export async function bookingActor(
  database: Kysely<Database>,
  proof: string | BookingActor,
  tripId: string,
): Promise<BookingActor> {
  const actor = await resolveBookingActor(
    database,
    tripId,
    typeof proof === "string" ? proof : proof.accountUserId,
  );
  if (typeof proof !== "string" && actor.planningOwnerId !== proof.planningOwnerId)
    planningNotFound();
  return actor;
}
export async function lockBookingTrip(
  transaction: Transaction<Database>,
  actor: BookingActor,
  tripId: string,
) {
  await lockPlanningAccess(transaction, {
    kind: "account",
    accountUserId: actor.accountUserId,
    planningOwnerId: actor.planningOwnerId,
  });
  return lockPlanningTrip(transaction, actor.planningOwnerId, tripId);
}
