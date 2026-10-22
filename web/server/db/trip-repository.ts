import { sql, type Insertable, type Selectable, type Transaction } from "kysely";

import type { TripVersion } from "@/domain/trip/schema";
import type { Database } from "@/server/db/database";
import type { AuditEventTable, OutboxEventTable, TripTable } from "@/server/db/types";

export type LockedTrip = Pick<
  Selectable<TripTable>,
  "id" | "ownerUserId" | "currentVersion" | "currency"
>;

export interface TripRepositoryPort {
  insertTrip(trip: Insertable<TripTable>): Promise<void>;
  lockTrip(tripId: string): Promise<LockedTrip | undefined>;
  insertVersion(version: TripVersion): Promise<void>;
  advanceCurrentVersion(
    tripId: string,
    expectedVersion: number,
    nextVersion: number,
    currency: string,
    changedAt: Date,
  ): Promise<boolean>;
  appendOutbox(event: Insertable<OutboxEventTable>): Promise<void>;
  appendAudit(event: Insertable<AuditEventTable>): Promise<void>;
  auditIdentity?(planningOwnerId: string): Promise<{ kind: "account" | "guest"; id: string }>;
}

export class TripRepository implements TripRepositoryPort {
  constructor(private readonly transaction: Transaction<Database>) {}
  async auditIdentity(planningOwnerId: string): Promise<{ kind: "account" | "guest"; id: string }> {
    const principal = await this.transaction
      .selectFrom("planningPrincipals")
      .select("accountUserId")
      .where("id", "=", planningOwnerId)
      .executeTakeFirstOrThrow();
    return principal.accountUserId
      ? { kind: "account", id: principal.accountUserId }
      : { kind: "guest", id: planningOwnerId };
  }

  async insertTrip(trip: Insertable<TripTable>): Promise<void> {
    await this.transaction.insertInto("trips").values(trip).executeTakeFirstOrThrow();
  }

  lockTrip(tripId: string): Promise<LockedTrip | undefined> {
    return this.transaction
      .selectFrom("trips")
      .select(["id", "ownerUserId", "currentVersion", "currency"])
      .where("id", "=", tripId)
      .forUpdate()
      .executeTakeFirst();
  }

  async insertVersion(version: TripVersion): Promise<void> {
    await this.transaction
      .insertInto("tripVersions")
      .values({
        ...version,
        // pg encodes JavaScript arrays as PostgreSQL arrays, not JSON arrays.
        changeSummary: sql<string[]>`${JSON.stringify(version.changeSummary)}::jsonb`,
        createdAt: new Date(version.createdAt),
      })
      .executeTakeFirstOrThrow();
  }

  async advanceCurrentVersion(
    tripId: string,
    expectedVersion: number,
    nextVersion: number,
    currency: string,
    changedAt: Date,
  ): Promise<boolean> {
    const updated = await this.transaction
      .updateTable("trips")
      .set({
        currentVersion: nextVersion,
        currency,
        // The application and database clocks may differ slightly. Keep durable
        // timestamps monotonic without rejecting an otherwise valid commit.
        updatedAt: sql<Date>`greatest(${changedAt}, created_at, updated_at)`,
        lastActivityAt: sql<Date>`greatest(${changedAt}, created_at, last_activity_at)`,
      })
      .where("id", "=", tripId)
      .where("currentVersion", "=", expectedVersion)
      .returning(["id"])
      .executeTakeFirst();
    return updated !== undefined;
  }

  async appendOutbox(event: Insertable<OutboxEventTable>): Promise<void> {
    await this.transaction.insertInto("outboxEvents").values(event).executeTakeFirstOrThrow();
  }

  async appendAudit(event: Insertable<AuditEventTable>): Promise<void> {
    await this.transaction.insertInto("auditEvents").values(event).executeTakeFirstOrThrow();
  }
}
