import { randomUUID } from "node:crypto";

import { z } from "zod";

import { inTransaction } from "@/server/db/transaction";
import { lockPlanningAccess, lockPlanningTrip } from "@/server/db/planning-access";
import { fingerprint } from "@/server/agent-client/run-repository";
import { IdempotencyFingerprintConflictError } from "@/server/db/idempotency-repository";
import { ProblemError, planningProblems } from "@/server/errors";
import { readOwnedTripVersion } from "@/domain/trip/read";

import { type PlanningIdentity } from "./planning-actor";
import { resourceActor } from "./planning-resource";

import type { Database } from "@/server/db/database";
import type { Kysely } from "kysely";

export const bookingIntentRequestSchema = z
  .object({ requestId: z.uuid(), tripId: z.uuid() })
  .strict();
export const linkRequestSchema = z.object({ requestId: z.uuid() }).strict();
export function bookingContinuationPath(tripId: string, lifecycle: string) {
  return ["draft", "finalized", "partially_booked", "booked"].includes(lifecycle)
    ? { nextPath: `/trips/${tripId}/booking` }
    : { nextPath: `/trips/${tripId}`, reason: "booking_unavailable" as const };
}
export async function currentBookingContinuation(
  database: Kysely<Database>,
  planningOwnerId: string,
  tripId: string,
  lifecycle: string,
) {
  const path = bookingContinuationPath(tripId, lifecycle);
  if ("reason" in path) return path;
  await readOwnedTripVersion(database, planningOwnerId, tripId);
  return path;
}
export async function createBookingIntent(
  database: Kysely<Database>,
  identity: PlanningIdentity,
  raw: unknown,
  now = new Date(),
) {
  const input = bookingIntentRequestSchema.parse(raw),
    actor = await resourceActor(database, identity, "trip", input.tripId);
  return inTransaction(database, async (transaction) => {
    await lockPlanningAccess(transaction, actor, now);
    const trip = await lockPlanningTrip(transaction, actor.planningOwnerId, input.tripId);
    const next = bookingContinuationPath(trip.id, trip.lifecycleState);
    if (actor.kind === "account")
      return currentBookingContinuation(
        transaction,
        actor.planningOwnerId,
        trip.id,
        trip.lifecycleState,
      );
    const snapshot = (await readOwnedTripVersion(transaction, actor.planningOwnerId, trip.id))
      .snapshot;
    if (
      "reason" in next ||
      snapshot.components.some(
        (component) =>
          !["flight", "accommodation", "activity", "rail", "transfer"].includes(component.type),
      )
    ) {
      throw new ProblemError({
        title: "This trip is not available for booking review",
        code: "booking_trip_not_available",
        status: 409,
      });
    }
    const hash = fingerprint({
      ...input,
      action: "review_booking",
      guestSessionId: actor.guestSessionId,
    });
    let intent = await transaction
      .selectFrom("bookingIntents")
      .selectAll()
      .where("guestSessionId", "=", actor.guestSessionId)
      .where("requestId", "=", input.requestId)
      .executeTakeFirst();
    const replayed = Boolean(intent);
    if (intent && intent.fingerprint !== hash) throw new IdempotencyFingerprintConflictError();
    if (intent && (intent.state !== "pending" || intent.expiresAt <= now))
      throw planningProblems.bookingIntentExpired();
    if (!intent)
      intent = await transaction
        .insertInto("bookingIntents")
        .values({
          id: randomUUID(),
          tripId: trip.id,
          planningOwnerId: actor.planningOwnerId,
          guestSessionId: actor.guestSessionId,
          requestId: input.requestId,
          fingerprint: hash,
          action: "review_booking",
          state: "pending",
          createdAt: now,
          expiresAt: new Date(now.getTime() + 1800000),
          consumedByUserId: null,
          consumedAt: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    return {
      intentId: intent.id,
      replayed,
      expiresAt: intent.expiresAt.toISOString(),
      signInPath: `/sign-in?intentId=${intent.id}`,
      signUpPath: `/sign-up?intentId=${intent.id}`,
      returnToPlanningPath: `/trips/${trip.id}`,
    };
  });
}
