import { createHmac } from "node:crypto";

import { sql, type Transaction } from "kysely";

import { CLARIFICATION_IDLE_MS } from "@/server/agent-client/run-lifecycle";
import { planningProblems } from "@/server/errors";

import type { Database } from "@/server/db/database";

export function networkDigest(networkKey: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`onholidai:guest-bootstrap:${networkKey}`)
    .digest("hex");
}
export async function reserveBootstrap(
  transaction: Transaction<Database>,
  digest: string,
  limit: number,
  now = new Date(),
): Promise<void> {
  // One per-network advisory guard serializes rolling-window counting across replicas.
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`guest-bootstrap:${digest}`}, 0))`.execute(
    transaction,
  );
  const cutoff = new Date(now.getTime() - 3600000);
  await transaction.deleteFrom("guestBootstrapBuckets").where("startedAt", "<=", cutoff).execute();
  const rows = await transaction
    .selectFrom("guestBootstrapBuckets")
    .select("sessionCount")
    .where("networkDigest", "=", digest)
    .where("startedAt", ">", cutoff)
    .execute();
  if (rows.reduce((total, row) => total + row.sessionCount, 0) >= limit)
    throw planningProblems.guestResearchLimited(3600);
  await transaction
    .insertInto("guestBootstrapBuckets")
    .values({ networkDigest: digest, startedAt: now, sessionCount: 1 })
    .onConflict((conflict) =>
      conflict
        .columns(["networkDigest", "startedAt"])
        .doUpdateSet({ sessionCount: sql<number>`app.guest_bootstrap_buckets.session_count + 1` }),
    )
    .execute();
}
export async function checkGuestResearch(
  transaction: Transaction<Database>,
  sessionId: string,
  limits: { active: number; hourly: number },
  now = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - 3600000);
  const clarificationCutoff = new Date(now.getTime() - CLARIFICATION_IDLE_MS);
  await transaction
    .deleteFrom("guestResearchRequests")
    .where("guestSessionId", "=", sessionId)
    .where("acceptedAt", "<=", cutoff)
    .execute();
  const recent = await transaction
    .selectFrom("guestResearchRequests")
    .select("requestId")
    .where("guestSessionId", "=", sessionId)
    .where("acceptedAt", ">", cutoff)
    .execute();
  const active = await transaction
    .selectFrom("agentRuns")
    .innerJoin("planningPrincipals", "planningPrincipals.id", "agentRuns.ownerUserId")
    .select("agentRuns.id")
    .where("planningPrincipals.guestSessionId", "=", sessionId)
    .where("agentRuns.planningAccessRevokedAt", "is", null)
    .where("agentRuns.status", "in", ["queued", "running", "awaiting_clarification"])
    .where((eb) =>
      eb.or([
        // An unanswered question stops holding the slot once it is abandoned.
        eb.and([
          eb("agentRuns.status", "=", "awaiting_clarification"),
          eb("agentRuns.phaseStartedAt", ">", clarificationCutoff),
        ]),
        eb.and([
          eb("agentRuns.status", "in", ["queued", "running"]),
          eb("agentRuns.leaseExpiresAt", ">", now),
        ]),
      ]),
    )
    .execute();
  if (recent.length >= limits.hourly || active.length >= limits.active)
    throw planningProblems.guestResearchLimited(recent.length >= limits.hourly ? 3600 : 30);
}
