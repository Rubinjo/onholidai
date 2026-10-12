import type { Kysely } from "kysely";
import { z } from "zod";

import { projectStoredSnapshot } from "@/domain/pricing/projections";
import { ProblemError } from "@/server/errors";
import type { Database } from "@/server/db/database";
import { TripVersionConflictError } from "./commit";
import { decodeTripSnapshot } from "./schema";

export async function readOwnedTripVersion(database: Kysely<Database>, ownerUserId: string,
  tripId: string, version?: number) {
  z.uuid().parse(tripId);
  if (version !== undefined) z.number().int().positive().parse(version);
  let query = database.selectFrom("trips").innerJoin("tripVersions", "trips.id", "tripVersions.tripId")
    .select(["trips.id", "trips.title", "trips.lifecycleState", "trips.currentVersion",
      "tripVersions.version", "tripVersions.schemaVersion", "tripVersions.snapshot", "tripVersions.createdAt"])
    .where("trips.id", "=", tripId).where("trips.ownerUserId", "=", ownerUserId);
  query = version === undefined ? query.whereRef("tripVersions.version", "=", "trips.currentVersion")
    : query.where("tripVersions.version", "=", version);
  const stored = await query.executeTakeFirst();
  if (!stored) throw new ProblemError({ title: "Trip not found", code: "trip_not_found", status: 404 });
  decodeTripSnapshot(stored.schemaVersion, stored.snapshot);
  return stored;
}

export async function readTrip(database: Kysely<Database>, ownerUserId: string, tripId: string,
  options: { version?: number; expectedVersion?: number } = {}) {
  const stored = await readOwnedTripVersion(database, ownerUserId, tripId, options.version);
  if (options.expectedVersion !== undefined && stored.currentVersion !== options.expectedVersion) {
    throw new TripVersionConflictError(options.expectedVersion, stored.currentVersion);
  }
  return { tripId: stored.id, version: stored.version, lifecycleState: stored.lifecycleState,
    snapshot: projectStoredSnapshot(stored.schemaVersion, stored.snapshot), updatedAt: stored.createdAt.toISOString() };
}

export const agentViewDetailSchema = z.enum(["compact", "itinerary", "components", "pricing", "constraints"]);
export type AgentViewDetail = z.infer<typeof agentViewDetailSchema>;

export async function readAgentTrip(database: Kysely<Database>, ownerUserId: string, tripId: string,
  expectedVersion: number, detail: AgentViewDetail) {
  agentViewDetailSchema.parse(detail);
  const envelope = await readTrip(database, ownerUserId, tripId, { expectedVersion });
  const snapshot = envelope.snapshot;
  // Keep the TripEnvelope shape while bounding the detail requested by the tool.
  return { ...envelope, snapshot: { ...snapshot,
    itineraryDays: detail === "itinerary" ? snapshot.itineraryDays.slice(0, 32) : [],
    components: detail === "components" ? snapshot.components : [],
  } };
}
