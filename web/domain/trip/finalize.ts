import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";
import { IdempotencyRepository } from "@/server/db/idempotency-repository";
import { ProblemError } from "@/server/errors";
import { readOwnedTripVersion, readTrip } from "./read";
import { tripSnapshotSchema } from "./schema";
import { evaluateFeasibility } from "./feasibility";
import { commitTripMutation } from "./commit";

export const finalizeCommandSchema = z.object({ requestId: z.uuid(), expectedVersion: z.number().int().positive(),
  acknowledgeUnverified: z.boolean(), reviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

export async function reviewFinalization(database: Kysely<Database>, userId: string, tripId: string) {
  const base = await readOwnedTripVersion(database, userId, tripId);
  const report = evaluateFeasibility(tripSnapshotSchema.parse(base.snapshot));
  return { tripId, version: base.currentVersion, report, reviewFingerprint: fingerprint({ version: base.currentVersion, report }) };
}

export async function finalizeTrip(database: Kysely<Database>, userId: string, tripId: string, raw: unknown) {
  const input = finalizeCommandSchema.parse(raw);
  return database.transaction().execute(async (transaction) => {
    const trip = await transaction.selectFrom("trips").selectAll().where("id", "=", tripId).where("ownerUserId", "=", userId).forUpdate().executeTakeFirst();
    if (!trip) runConflict();
    const scope = `trip:${tripId}:finalize`, hash = fingerprint({ userId, ...input });
    const receipts = new IdempotencyRepository(transaction);
    const claim = await receipts.claim({ scope, key: input.requestId, requestFingerprint: hash, expiresAt: new Date(Date.now() + 86400000) });
    if (claim.kind === "replay") return claim.result;
    if (trip.currentVersion !== input.expectedVersion || trip.lifecycleState !== "draft") runConflict();
    const base = await readOwnedTripVersion(transaction, userId, tripId);
    // Parsing independently checks all references and exact component price sums.
    const snapshot = tripSnapshotSchema.parse(base.snapshot), report = evaluateFeasibility(snapshot);
    if (fingerprint({ version: base.currentVersion, report }) !== input.reviewFingerprint) runConflict();
    if (report.blocking.length || ((report.unverified.length || report.exceptions.length) && !input.acknowledgeUnverified)) {
      // Failed review stays a draft, creates no version and does not consume the key.
      throw new FinalizationBlocked(report);
    }
    const retainedWarnings = snapshot.warnings.filter((entry) => !entry.code.startsWith("finalization_"));
    snapshot.warnings = [...retainedWarnings,
      ...[...report.unverified, ...report.exceptions].slice(0, 64 - retainedWarnings.length).map((entry) => ({
        code: "finalization_" + entry.code, message: entry.message.slice(0, 1000), severity: "warning" as const, relatedIds: entry.relatedIds.slice(0, 64) }))];
    const receipt = await commitTripMutation(transaction, { tripId, ownerUserId: userId, expectedVersion: input.expectedVersion,
      requestId: input.requestId, idempotencyKey: input.requestId, requestFingerprint: hash, snapshot,
      lifecycleState: "finalized", initiatingActor: "user", proposalId: null, changeSummary: ["finalization", "feasibility_policy_v1"],
      inverseOperation: { operation: "replace", target: "/", value: base.snapshot }, nonReversibleReason: null,
      outboxEventId: randomUUID(), auditEventId: randomUUID() });
    const result = await readTrip(transaction, userId, tripId, { version: receipt.version });
    await receipts.complete(scope, input.requestId, hash, { ...result });
    return result;
  });
}

class FinalizationBlocked extends ProblemError {
  constructor(report: ReturnType<typeof evaluateFeasibility>) {
    super({ title: "Finalization needs review", status: 409, code: "finalization_blocked",
      detail: report.blocking.length ? report.blocking.map((issue) => issue.message).join(" ").slice(0, 2000) : "Review and acknowledge the unverified conditions and exceptions." });
  }
}
