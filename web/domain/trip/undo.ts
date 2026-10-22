import { randomUUID } from "node:crypto";

import { z } from "zod";

import { inTransaction } from "@/server/db/transaction";
import { fingerprint, runConflict } from "@/server/agent-client/run-repository";

import { commitTripMutation } from "./commit";
import { readTrip } from "./read";
import { tripSnapshotSchema } from "./schema";

import type { Kysely } from "kysely";
import type { Database } from "@/server/db/database";

export const undoSchema = z
  .object({
    requestId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    restoreVersion: z.number().int().positive(),
  })
  .strict();
export async function undoDraft(
  database: Kysely<Database>,
  userId: string,
  tripId: string,
  raw: unknown,
) {
  const input = undoSchema.parse(raw);
  return inTransaction(database, async (transaction) => {
    const trip = await transaction
      .selectFrom("trips")
      .selectAll()
      .where("id", "=", tripId)
      .where("ownerUserId", "=", userId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !trip ||
      !["draft", "finalized"].includes(trip.lifecycleState) ||
      input.restoreVersion >= input.expectedVersion
    )
      runConflict();
    const rows = await transaction
      .selectFrom("tripVersions")
      .selectAll()
      .where("tripId", "=", tripId)
      .where("version", ">=", input.restoreVersion)
      .where("version", "<=", input.expectedVersion)
      .orderBy("version")
      .execute();
    const target = rows[0],
      current = rows.at(-1);
    if (
      !target ||
      !current ||
      rows.length !== input.expectedVersion - input.restoreVersion + 1 ||
      rows.some(
        (row) =>
          row.initiatingActor === "booking_workflow" ||
          row.snapshot.components.some((component) => component.bookingStatus !== "unbooked"),
      ) ||
      rows.slice(1).some((row) => row.nonReversibleReason !== null)
    )
      runConflict();
    const receipt = await commitTripMutation(transaction, {
      tripId,
      ownerUserId: userId,
      expectedVersion: input.expectedVersion,
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      requestFingerprint: fingerprint(input),
      snapshot: tripSnapshotSchema.parse(target.snapshot),
      lifecycleState: "draft",
      initiatingActor: "user",
      proposalId: null,
      changeSummary: [`Restored draft content from version ${input.restoreVersion}`],
      inverseOperation: { operation: "replace", target: "/", value: current.snapshot },
      nonReversibleReason: null,
      outboxEventId: randomUUID(),
      auditEventId: randomUUID(),
    });
    return readTrip(transaction, userId, tripId, { version: receipt.version });
  });
}
