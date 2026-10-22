import "server-only";

import { randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";

import { requireInternalTeamRole } from "@/server/auth/authorize";
import { inTransaction } from "@/server/db/transaction";

import type { AuthorizationSession } from "@/server/auth/authorize";
import type { Database } from "@/server/db/database";

export const RAW_CONVERSATION_RETENTION_DAYS = 90;
export const TRIP_RECORD_RETENTION_MONTHS = 24;
export const RETENTION_REVIEW_CATEGORIES = [
  "trip_versions",
  "booking_records",
  "authorizations",
  "audit_evidence",
] as const;

export type RetentionReview = {
  tripId: string;
  ownerUserId: string;
  lastActivityAt: Date;
  reviewAfter: Date;
  status: "not_due" | "legal_hold" | "review_required";
  protectedCategories: (typeof RETENTION_REVIEW_CATEGORIES)[number][];
};

export type RetentionDeletionRequest = {
  tripId: string;
  ownerUserId: string;
  categories: readonly string[];
  reviewedAt: Date;
};

/** Business policy owns whether deletion is lawful and which records may be removed. */
export interface RetentionDeletionPolicy {
  readonly policyId: string;
  authorizeDeletion(request: RetentionDeletionRequest): Promise<{
    allowed: boolean;
    reasonCode: string;
  }>;
}

export function addCalendarMonths(date: Date, months: number): Date {
  if (!Number.isInteger(months)) throw new RangeError("months must be an integer");
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const finalDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, finalDay));
  return result;
}

export function rawConversationExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + RAW_CONVERSATION_RETENTION_DAYS * 86_400_000);
}

// Access expiry never deletes accepted history or principals. Only short-lived
// quota metadata is cleaned automatically; partial drafts enter policy review.
export async function cleanupGuestQuotaMetadata(
  database: Kysely<Database>,
  now = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - 3600000);
  await database.deleteFrom("guestResearchRequests").where("acceptedAt", "<=", cutoff).execute();
  await database.deleteFrom("guestBootstrapBuckets").where("startedAt", "<=", cutoff).execute();
}
export async function reviewSetupDraftRetention(database: Kysely<Database>, now = new Date()) {
  const drafts = await database
    .selectFrom("setupDrafts")
    .select(["id", "planningOwnerId", "updatedAt"])
    .where("submittedTripId", "is", null)
    .execute();
  return drafts.map((draft) => ({
    draftId: draft.id,
    planningOwnerId: draft.planningOwnerId,
    reviewAfter: addCalendarMonths(draft.updatedAt, TRIP_RECORD_RETENTION_MONTHS),
    status:
      now >= addCalendarMonths(draft.updatedAt, TRIP_RECORD_RETENTION_MONTHS)
        ? "review_required"
        : "not_due",
  }));
}

export async function expireRawConversationMessages(
  database: Kysely<Database>,
  now = new Date(),
  batchSize = 500,
): Promise<number> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5_000) {
    throw new RangeError("batchSize must be between 1 and 5000");
  }
  await cleanupGuestQuotaMetadata(database, now);
  // Composes with the request transaction: the messages read that triggers retention
  // already runs inside one, and Kysely rejects a nested transaction.
  return inTransaction(database, async (transaction) => {
    const expired = await transaction
      .selectFrom("conversationMessages")
      .select("id")
      .where("retentionExpiresAt", "<=", now)
      .where(sql<boolean>`COALESCE(content->>'kind', '') <> 'expired'`)
      .orderBy("retentionExpiresAt")
      .forUpdate()
      .skipLocked()
      .limit(batchSize)
      .execute();
    if (expired.length === 0) return 0;
    const ids = expired.map((message) => message.id);
    await transaction
      .updateTable("conversationMessages")
      .set({ content: { kind: "expired" } })
      .where("id", "in", ids)
      .execute();
    return ids.length;
  });
}

export function evaluateRetentionReview(input: {
  tripId: string;
  ownerUserId: string;
  lastActivityAt: Date;
  now?: Date;
  legalHoldActive: boolean;
}): RetentionReview {
  const reviewAfter = addCalendarMonths(input.lastActivityAt, TRIP_RECORD_RETENTION_MONTHS);
  const status = input.legalHoldActive
    ? "legal_hold"
    : (input.now ?? new Date()) >= reviewAfter
      ? "review_required"
      : "not_due";
  return {
    tripId: input.tripId,
    ownerUserId: input.ownerUserId,
    lastActivityAt: input.lastActivityAt,
    reviewAfter,
    status,
    // Transaction evidence and immutable history remain preserved until a configured business policy approves otherwise.
    protectedCategories: [...RETENTION_REVIEW_CATEGORIES],
  };
}

export async function reviewTripRetention(
  database: Kysely<Database>,
  tripId: string,
  now = new Date(),
): Promise<RetentionReview> {
  const trip = await database
    .selectFrom("trips")
    .select(["id", "ownerUserId", "lastActivityAt"])
    .where("id", "=", tripId)
    .executeTakeFirst();
  if (!trip) throw new Error("trip_not_found");
  const activeHold = await database
    .selectFrom("privacyLegalHolds")
    .select("id")
    .where("tripId", "=", tripId)
    .where("releasedAt", "is", null)
    .executeTakeFirst();
  return evaluateRetentionReview({
    tripId,
    ownerUserId: trip.ownerUserId,
    lastActivityAt: trip.lastActivityAt,
    now,
    legalHoldActive: Boolean(activeHold),
  });
}

export async function placeLegalHold(
  database: Kysely<Database>,
  session: AuthorizationSession | null,
  tripId: string,
  reasonCode: string,
  now = new Date(),
) {
  const user = requireInternalTeamRole(session, ["admin", "administrator"]);
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(reasonCode))
    throw new Error("invalid_legal_hold_reason_code");
  return database.transaction().execute(async (transaction) => {
    const trip = await transaction
      .selectFrom("trips")
      .select(["id", "ownerUserId"])
      .where("id", "=", tripId)
      .executeTakeFirst();
    if (!trip) throw new Error("trip_not_found");
    const existing = await transaction
      .selectFrom("privacyLegalHolds")
      .select("id")
      .where("tripId", "=", tripId)
      .where("releasedAt", "is", null)
      .executeTakeFirst();
    if (existing) return existing;
    const hold = {
      id: randomUUID(),
      tripId,
      ownerUserId: trip.ownerUserId,
      reasonCode,
      createdBy: user.id,
      createdAt: now,
      releasedBy: null,
      releasedAt: null,
    };
    await transaction.insertInto("privacyLegalHolds").values(hold).execute();
    await transaction
      .insertInto("auditEvents")
      .values({
        id: randomUUID(),
        actorType: "user",
        actorId: user.id,
        action: "privacy.legal_hold.placed",
        targetType: "trip",
        targetId: tripId,
        requestId: randomUUID(),
        traceId: null,
        outcome: "succeeded",
        metadata: { holdId: hold.id, reasonCode },
        occurredAt: now,
      })
      .execute();
    return { id: hold.id };
  });
}

export async function releaseLegalHold(
  database: Kysely<Database>,
  session: AuthorizationSession | null,
  holdId: string,
  now = new Date(),
) {
  const user = requireInternalTeamRole(session, ["admin", "administrator"]);
  return database.transaction().execute(async (transaction) => {
    const hold = await transaction
      .selectFrom("privacyLegalHolds")
      .selectAll()
      .where("id", "=", holdId)
      .forUpdate()
      .executeTakeFirst();
    if (!hold) throw new Error("legal_hold_not_found");
    if (hold.releasedAt) return { released: false };
    await transaction
      .updateTable("privacyLegalHolds")
      .set({ releasedBy: user.id, releasedAt: now })
      .where("id", "=", holdId)
      .execute();
    await transaction
      .insertInto("auditEvents")
      .values({
        id: randomUUID(),
        actorType: "user",
        actorId: user.id,
        action: "privacy.legal_hold.released",
        targetType: "trip",
        targetId: hold.tripId,
        requestId: randomUUID(),
        traceId: null,
        outcome: "succeeded",
        metadata: { holdId },
        occurredAt: now,
      })
      .execute();
    return { released: true };
  });
}

export async function authorizeRetentionDeletion(
  policy: RetentionDeletionPolicy | undefined,
  request: RetentionDeletionRequest,
): Promise<{ allowed: boolean; policyId: string; reasonCode: string }> {
  if (!policy || !policy.policyId.trim())
    throw new Error("retention_business_policy_not_configured");
  const decision = await policy.authorizeDeletion(request);
  return { ...decision, policyId: policy.policyId };
}
