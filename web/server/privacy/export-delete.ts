import "server-only";

import { requireOwnerOrInternalTeamRole, type AuthorizationSession } from "@/server/auth/authorize";
import { projectStoredSnapshot } from "@/domain/pricing/projections";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import { redactConversation } from "@/server/db/conversation-repository";
import { authorizeRetentionDeletion, reviewTripRetention, type RetentionDeletionPolicy, type RetentionDeletionRequest } from "./retention";

export const PRIVACY_EXPORT_SCOPES = ["trip", "conversation", "booking", "audit"] as const;
export type PrivacyExportScope = typeof PRIVACY_EXPORT_SCOPES[number];

function permittedScopes(isOwner: boolean): ReadonlySet<PrivacyExportScope> {
  return isOwner ? new Set<PrivacyExportScope>(PRIVACY_EXPORT_SCOPES)
    : new Set<PrivacyExportScope>(["trip", "booking", "audit"]);
}

export async function exportTripData(
  database: Kysely<Database>,
  session: AuthorizationSession | null,
  tripId: string,
  requestedScopes: readonly PrivacyExportScope[] = PRIVACY_EXPORT_SCOPES,
) {
  const trip = await database.selectFrom("trips").selectAll().where("id", "=", tripId).executeTakeFirst();
  if (!trip) throw new Error("trip_not_found");
  const user = requireOwnerOrInternalTeamRole(session, trip.ownerUserId, ["support", "operations", "admin", "administrator"]);
  const owner = user.id === trip.ownerUserId;
  const allowed = permittedScopes(owner);
  const scopes = [...new Set(requestedScopes)];
  if (scopes.some((scope) => !PRIVACY_EXPORT_SCOPES.includes(scope) || !allowed.has(scope))) {
    throw new Error("privacy_export_scope_denied");
  }

  const versions = scopes.includes("trip") ? await database.selectFrom("tripVersions").selectAll()
    .where("tripId", "=", tripId).orderBy("version").execute() : [];
  const conversations = scopes.includes("conversation") ? await database.selectFrom("conversations").selectAll()
    .where("tripId", "=", tripId).where("ownerUserId", "=", trip.ownerUserId).execute() : [];
  const messages = conversations.length ? await database.selectFrom("conversationMessages").selectAll()
    .where("conversationId", "in", conversations.map((entry) => entry.id))
    .where("retentionExpiresAt", ">", new Date()).orderBy("createdAt").execute() : [];
  const bookings = scopes.includes("booking") ? await database.selectFrom("bookingTransactions").selectAll()
    .where("tripId", "=", tripId).orderBy("startedAt").execute() : [];
  const authorizations = scopes.includes("booking") ? await database.selectFrom("bookingAuthorizations").selectAll()
    .where("tripId", "=", tripId).orderBy("createdAt").execute() : [];
  const audit = scopes.includes("audit") ? await database.selectFrom("auditEvents").selectAll()
    .where("targetType", "=", "trip").where("targetId", "=", tripId).orderBy("occurredAt").execute() : [];

  return {
    exportedAt: new Date().toISOString(),
    scopes,
    trip: scopes.includes("trip") ? { id: trip.id, title: trip.title, lifecycleState: trip.lifecycleState,
      currentVersion: trip.currentVersion, currency: trip.currency, createdAt: trip.createdAt.toISOString(),
      lastActivityAt: trip.lastActivityAt.toISOString(), versions: versions.map((version) => ({
        version: version.version, schemaVersion: version.schemaVersion,
        snapshot: projectStoredSnapshot(version.schemaVersion, version.snapshot),
        initiatingActor: version.initiatingActor, changeSummary: version.changeSummary,
        createdAt: version.createdAt.toISOString(),
      })) } : undefined,
    conversations: scopes.includes("conversation") ? messages.map((message) => ({ id: message.id,
      role: message.role, content: redactConversation(typeof message.content.text === "string" ? message.content.text : "Saved planning message"),
      createdAt: message.createdAt.toISOString(), tripVersion: message.tripVersion })) : undefined,
    bookings: scopes.includes("booking") ? {
      transactions: bookings.map((booking) => ({ id: booking.id, operation: booking.operation, status: booking.status,
        components: booking.components, startedAt: booking.startedAt.toISOString(), completedAt: booking.completedAt?.toISOString() ?? null })),
      authorizations: authorizations.map((authorization) => ({ id: authorization.id, operation: authorization.operation,
        status: authorization.status, tripVersion: authorization.tripVersion, termsHash: authorization.termsHash,
        authorizedAt: authorization.authorizedAt.toISOString(), expiresAt: authorization.expiresAt.toISOString() })),
    } : undefined,
    audit: scopes.includes("audit") ? audit.map((event) => ({ id: event.id, action: event.action,
      outcome: event.outcome, requestId: event.requestId, occurredAt: event.occurredAt.toISOString() })) : undefined,
  };
}

export async function requestTripDataDeletion(
  database: Kysely<Database>,
  session: AuthorizationSession | null,
  policy: RetentionDeletionPolicy | undefined,
  request: Omit<RetentionDeletionRequest, "ownerUserId">,
) {
  const trip = await database.selectFrom("trips").select(["ownerUserId"])
    .where("id", "=", request.tripId).executeTakeFirst();
  if (!trip) throw new Error("trip_not_found");
  requireOwnerOrInternalTeamRole(session, trip.ownerUserId, ["admin", "administrator"]);
  const review = await reviewTripRetention(database, request.tripId, request.reviewedAt);
  if (review.status !== "review_required") throw new Error(`retention_review_${review.status}`);
  const ownedRequest = { ...request, ownerUserId: trip.ownerUserId };
  return authorizeRetentionDeletion(policy, ownedRequest);
}
