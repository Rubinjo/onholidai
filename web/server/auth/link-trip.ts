import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { z } from "zod";
import type { Database } from "@/server/db/database";
import { inTransaction } from "@/server/db/transaction";
import { lockPlanningAccess, lockPlanningTrip } from "@/server/db/planning-access";
import { PlanningLinkRepository } from "@/server/db/planning-link-repository";
import { IdempotencyFingerprintConflictError } from "@/server/db/idempotency-repository";
import { fingerprint, revokePrincipalRuns } from "@/server/agent-client/run-repository";
import { planningProblems } from "@/server/errors";
import { planningNotFound, type PlanningIdentity } from "./planning-actor";
import { currentBookingContinuation, linkRequestSchema } from "./booking-intent";
import { validPlanningSession } from "./planning-session";

export async function linkTrip(database: Kysely<Database>, identity: PlanningIdentity, intentId: string, raw: unknown, now?: Date) {
  z.uuid().parse(intentId);
  const input = linkRequestSchema.parse(raw);
  if (!identity.accountUserId) throw planningProblems.authenticationRequired();
  const accountUserId = identity.accountUserId, intent = await new PlanningLinkRepository(database).intent(intentId);
  if (!intent) planningNotFound();
  const hash = fingerprint({ intentId, requestId: input.requestId, accountUserId, action: "review_booking" });
  return inTransaction(database, async (transaction) => {
    // Even a receipt replay needs a fresh account binding check; original guest
    // proof is required only for the first claim, never identifiers alone.
    let receipt = await new PlanningLinkRepository(transaction).receipt(intent.planningOwnerId);
    if (receipt) {
      if (receipt.accountUserId !== accountUserId || receipt.tripId !== intent.tripId) planningNotFound();
      if (receipt.requestId === input.requestId && receipt.fingerprint !== hash) throw new IdempotencyFingerprintConflictError();
      await lockPlanningAccess(transaction, { kind: "account", accountUserId, planningOwnerId: receipt.planningOwnerId }, now);
      const trip = await lockPlanningTrip(transaction, receipt.planningOwnerId, receipt.tripId);
      return { tripId: trip.id, version: trip.currentVersion, linked: true, replayed: true, ...await currentBookingContinuation(transaction, receipt.planningOwnerId, trip.id, trip.lifecycleState) };
    }
    if (identity.guestSessionId !== intent.guestSessionId) planningNotFound();
    const session = await transaction.selectFrom("guestPlanningSessions").selectAll().where("id", "=", intent.guestSessionId).forUpdate().executeTakeFirst();
    const principal = await transaction.selectFrom("planningPrincipals").selectAll().where("id", "=", intent.planningOwnerId).forUpdate().executeTakeFirst();
    if (!principal) planningNotFound();
    // A competing claim can have committed while waiting for the session guard.
    receipt = await new PlanningLinkRepository(transaction).receipt(intent.planningOwnerId);
    if (receipt) {
      if (receipt.accountUserId !== accountUserId || principal.accountUserId !== accountUserId) planningNotFound();
      if (receipt.requestId === input.requestId && receipt.fingerprint !== hash) throw new IdempotencyFingerprintConflictError();
      const trip = await lockPlanningTrip(transaction, receipt.planningOwnerId, receipt.tripId);
      return { tripId: trip.id, version: trip.currentVersion, linked: true, replayed: true, ...await currentBookingContinuation(transaction, receipt.planningOwnerId, trip.id, trip.lifecycleState) };
    }
    if (!session || !validPlanningSession(session, now ?? new Date()) || principal.guestSessionId !== intent.guestSessionId || principal.accountUserId !== null) planningNotFound();
    const draft = await transaction.selectFrom("setupDrafts").selectAll().where("planningOwnerId", "=", intent.planningOwnerId).forUpdate().executeTakeFirst();
    const trip = await lockPlanningTrip(transaction, intent.planningOwnerId, intent.tripId);
    const linkedAt = now ?? new Date();
    if (intent.expiresAt <= linkedAt) throw planningProblems.bookingIntentExpired();
    await revokePrincipalRuns(transaction, intent.planningOwnerId, linkedAt);
    const lockedIntent = await transaction.selectFrom("bookingIntents").selectAll().where("id", "=", intent.id).forUpdate().executeTakeFirstOrThrow();
    if (lockedIntent.state !== "pending") throw planningProblems.bookingIntentExpired();
    await transaction.updateTable("planningPrincipals").set({ accountUserId, guestSessionId: null, linkedAt })
      .where("id", "=", intent.planningOwnerId).execute();
    if (draft) await transaction.updateTable("setupDrafts").set({ revision: draft.revision + 1, updatedAt: linkedAt }).where("id", "=", draft.id).execute();
    await transaction.insertInto("planningAccountLinks").values({ planningOwnerId: intent.planningOwnerId, tripId: trip.id,
      guestSessionId: intent.guestSessionId, accountUserId, intentId: intent.id, requestId: input.requestId, fingerprint: hash,
      linkedAt, tripVersionAtLink: trip.currentVersion }).execute();
    await transaction.updateTable("bookingIntents").set({ state: "consumed", consumedByUserId: accountUserId, consumedAt: linkedAt }).where("id", "=", intent.id).execute();
    await transaction.insertInto("auditEvents").values({ id: randomUUID(), actorType: "user", actorId: accountUserId,
      action: "planning.account.linked", targetType: "trip", targetId: trip.id, requestId: input.requestId, traceId: null,
      outcome: "succeeded", occurredAt: linkedAt, metadata: { planningOwnerId: intent.planningOwnerId, tripVersion: trip.currentVersion } }).execute();
    const commitAt = now ?? new Date();
    if (!validPlanningSession(session, commitAt)) planningNotFound();
    if (intent.expiresAt <= commitAt) throw planningProblems.bookingIntentExpired();
    return { tripId: trip.id, version: trip.currentVersion, linked: true, replayed: false, ...await currentBookingContinuation(transaction, intent.planningOwnerId, trip.id, trip.lifecycleState) };
  });
}
