import { sql, type Kysely, type Selectable } from "kysely";

import type { TripSnapshot } from "@/domain/trip/schema";
import type { Database } from "@/server/db/database";
import type { OutboxEventTable } from "@/server/db/types";

export type ClaimedOutboxEvent = Selectable<OutboxEventTable>;

export interface OutboxRepositoryPort {
  claimBatch(now: Date, batchSize: number, leaseMilliseconds: number): Promise<ClaimedOutboxEvent[]>;
  markDelivered(eventId: string, deliveredAt: Date): Promise<void>;
  markFailed(eventId: string, nextAttemptAt: Date, errorCategory: string): Promise<void>;
}

export class OutboxRepository implements OutboxRepositoryPort {
  constructor(private readonly database: Kysely<Database>) {}

  claimBatch(now: Date, batchSize: number, leaseMilliseconds: number): Promise<ClaimedOutboxEvent[]> {
    const leaseExpiresAt = new Date(now.getTime() + leaseMilliseconds);
    return this.database.transaction().execute(async (transaction) => {
      const candidates = await transaction
        .selectFrom("outboxEvents")
        .select(["id"])
        .where((expression) =>
          expression.or([
            expression.and([
              expression("deliveryState", "in", ["pending", "failed"]),
              expression("nextAttemptAt", "<=", now),
            ]),
            expression.and([
              expression("deliveryState", "=", "delivering"),
              expression("leaseExpiresAt", "is not", null),
              expression("leaseExpiresAt", "<=", now),
            ]),
          ]),
        )
        .orderBy("createdAt")
        .forUpdate()
        .skipLocked()
        .limit(batchSize)
        .execute();

      const ids = candidates.map(({ id }) => id);
      if (ids.length === 0) return [];

      return transaction
        .updateTable("outboxEvents")
        .set({
          deliveryState: "delivering",
          attempts: sql<number>`attempts + 1`,
          leaseExpiresAt,
          lastErrorCategory: null,
        })
        .where("id", "in", ids)
        .returningAll()
        .execute();
    });
  }

  async markDelivered(eventId: string, deliveredAt: Date): Promise<void> {
    await this.database
      .updateTable("outboxEvents")
      .set({
        deliveryState: "delivered",
        deliveredAt,
        leaseExpiresAt: null,
        lastErrorCategory: null,
      })
      .where("id", "=", eventId)
      .where("deliveryState", "=", "delivering")
      .executeTakeFirst();
  }

  async markFailed(eventId: string, nextAttemptAt: Date, errorCategory: string): Promise<void> {
    await this.database
      .updateTable("outboxEvents")
      .set({
        deliveryState: "failed",
        nextAttemptAt,
        leaseExpiresAt: null,
        lastErrorCategory: errorCategory,
      })
      .where("id", "=", eventId)
      .where("deliveryState", "=", "delivering")
      .executeTakeFirst();
  }
}

export interface OutboxPublisher {
  publish(event: ClaimedOutboxEvent, options: { idempotencyKey: string }): Promise<void>;
}

export interface DeliverOutboxOptions {
  now?: () => Date;
  batchSize?: number;
  leaseMilliseconds?: number;
  baseRetryMilliseconds?: number;
}

export async function deliverOutboxBatch(
  repository: OutboxRepositoryPort,
  publisher: OutboxPublisher,
  options: DeliverOutboxOptions = {},
): Promise<{ delivered: number; failed: number }> {
  const now = options.now ?? (() => new Date());
  const claimedAt = now();
  const events = await repository.claimBatch(
    claimedAt,
    options.batchSize ?? 50,
    options.leaseMilliseconds ?? 30_000,
  );
  let delivered = 0;
  let failed = 0;

  for (const event of events) {
    try {
      await publisher.publish(event, { idempotencyKey: event.id });
      await repository.markDelivered(event.id, now());
      delivered += 1;
    } catch {
      const baseRetry = options.baseRetryMilliseconds ?? 1_000;
      const delay = Math.min(baseRetry * 2 ** Math.min(event.attempts, 10), 15 * 60_000);
      await repository.markFailed(event.id, new Date(now().getTime() + delay), "delivery_error");
      failed += 1;
    }
  }
  return { delivered, failed };
}

export interface TripEventReceiptStore {
  begin(eventId: string): Promise<boolean>;
  complete(eventId: string): Promise<void>;
  abandon(eventId: string): Promise<void>;
}

export interface TripEventEnvelope {
  id: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Readonly<Record<string, unknown>>;
}

export async function consumeTripEvent(
  event: TripEventEnvelope,
  receipts: TripEventReceiptStore,
  reloadCommittedSnapshot: (tripId: string, version: number) => Promise<TripSnapshot>,
): Promise<{ duplicate: boolean; snapshot?: TripSnapshot }> {
  if (!(await receipts.begin(event.id))) {
    return { duplicate: true };
  }
  try {
    const snapshot = await reloadCommittedSnapshot(event.aggregateId, event.aggregateVersion);
    await receipts.complete(event.id);
    return { duplicate: false, snapshot };
  } catch (error) {
    await receipts.abandon(event.id);
    throw error;
  }
}
