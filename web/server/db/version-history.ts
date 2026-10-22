import { readTrip } from "@/domain/trip/read";
import { projectStoredSnapshot } from "@/domain/pricing/projections";

import type { Kysely } from "kysely";
import type { Database } from "./database";

export async function readVersionHistory(
  database: Kysely<Database>,
  userId: string,
  tripId: string,
  afterVersion = 0,
) {
  await readTrip(database, userId, tripId);
  const rows = await database
    .selectFrom("tripVersions")
    .selectAll()
    .where("tripId", "=", tripId)
    .where("version", ">", afterVersion)
    .orderBy("version")
    .limit(100)
    .execute();
  return {
    items: rows.map((row) => ({
      version: row.version,
      initiatingActor: row.initiatingActor,
      initiatingRequestId: row.initiatingRequestId,
      affectedFacts: row.changeSummary,
      reversible: row.inverseOperation !== null && row.initiatingActor !== "booking_workflow",
      snapshot: projectStoredSnapshot(row.schemaVersion, row.snapshot),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
