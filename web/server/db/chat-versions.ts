import { sql, type Kysely } from "kysely";
import type { Database } from "./database";
import { readTrip } from "@/domain/trip/read";
import { redactConversation } from "./conversation-repository";
import { chatVersionsSchema } from "./chat-versions-schema";

// Version records, not expiring raw messages, are the durable chat checkpoints.
export async function readChatVersions(database: Kysely<Database>, userId: string, tripId: string, beforeVersion?: number) {
  const current = await readTrip(database, userId, tripId);
  const barriers = await database.selectFrom("tripVersions").where("tripId", "=", tripId).select([
    sql<number>`coalesce(max(case when initiating_actor = 'booking_workflow'
      or exists (select 1 from jsonb_array_elements(snapshot->'components') c where c->>'bookingStatus' <> 'unbooked')
      then version + 1 when non_reversible_reason is not null then version else 0 end), 0)`.as("minimumVersion"),
  ]).executeTakeFirstOrThrow();
  const activeWrite = await database.selectFrom("bookingWriteClaims").select("transactionId").where("tripId", "=", tripId).executeTakeFirst();
  let query = database.selectFrom("tripVersions as v").leftJoin("changeProposals as p", "p.id", "v.proposalId")
    .select(["v.version", "v.previousVersion", "v.changeSummary", "v.createdAt", "v.schemaVersion", "v.initiatingActor", "v.initiatingRequestId", "v.proposalId", "p.agentRunId"])
    .where("v.tripId", "=", tripId).orderBy("v.version", "desc").limit(51);
  if (beforeVersion) query = query.where("v.version", "<", beforeVersion);
  const rows = await query.execute();
  return chatVersionsSchema.parse({ items: rows.slice(0, 50).map((row) => {
    const reason = row.version === current.version ? "Current trip" : !["draft", "finalized"].includes(current.lifecycleState) || activeWrite
      ? "Booking activity prevents restoration. Manage reservations separately."
      : row.version < Number(barriers.minimumVersion) ? "This version crosses a non-reversible booking or trip change."
      : row.schemaVersion !== 1 ? "This older format needs a compatible planning update before restoration." : null;
    return { version: row.version, previousVersion: row.previousVersion, actor: row.initiatingActor, requestId: row.initiatingRequestId, proposalId: row.proposalId,
      summary: row.changeSummary.map((line) => redactConversation(line).slice(0, 256)).slice(0, 6),
      createdAt: row.createdAt.toISOString(), runId: row.agentRunId, restorable: reason === null, restoreReason: reason };
  }), nextBeforeVersion: rows.length > 50 ? rows[49].version : null });
}
