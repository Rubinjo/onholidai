import { z } from "zod";

import { PlanningLinkRepository } from "@/server/db/planning-link-repository";

import { planningNotFound, resolvePlanningActor, type PlanningIdentity } from "./planning-actor";

import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";

export async function continuationReference(
  database: Kysely<Database>,
  identity: PlanningIdentity,
  intentId: string,
) {
  z.uuid().parse(intentId);
  const repository = new PlanningLinkRepository(database),
    intent = await repository.intent(intentId);
  if (!intent) planningNotFound();
  const receipt = await repository.receipt(intent.planningOwnerId);
  if (receipt) {
    if (receipt.accountUserId !== identity.accountUserId || receipt.tripId !== intent.tripId)
      planningNotFound();
  } else if (intent.guestSessionId !== identity.guestSessionId) planningNotFound();
  await resolvePlanningActor(database, intent.planningOwnerId, identity);
  return { tripId: intent.tripId, returnPath: `/trips/${intent.tripId}` };
}
