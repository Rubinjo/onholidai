// @vitest-environment node
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  OutboxRepository,
  PostgresTripEventReceiptStore,
  consumeTripEvent,
  deliverOutboxBatch,
} from "../../server/db/outbox";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

import type { Kysely } from "kysely";
import type { Database } from "../../server/db/database";

const TRIP_EVENT = "trip.version.committed";
const BOOKING_EVENT = "booking.transaction.requested";

async function insertEvent(database: Kysely<Database>, eventType: string): Promise<string> {
  const id = randomUUID();
  await database
    .insertInto("outboxEvents")
    .values({
      id,
      eventType,
      eventVersion: 1,
      aggregateType: eventType.startsWith("booking") ? "booking" : "trip",
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      payload: { reloadRequired: true },
      nextAttemptAt: new Date(Date.now() - 60_000),
    })
    .execute();
  return id;
}

const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;

describeWithDatabase("outbox delivery and trip event consumption", () => {
  it("claims only the requested event types so trip events are never failed by the booking dispatcher", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const trip = await insertEvent(database, TRIP_EVENT);
      const booking = await insertEvent(database, BOOKING_EVENT);
      const repository = new OutboxRepository(database);
      const now = new Date();

      const scoped = await repository.claimBatch(now, 10, 30_000, [BOOKING_EVENT]);
      expect(scoped.map((event) => event.id)).toEqual([booking]);
      // An unfiltered claim still sees the untouched trip event.
      const all = await repository.claimBatch(now, 10, 30_000);
      expect(all.map((event) => event.id)).toEqual([trip]);
    });
  });

  it("holds a lease, refuses concurrent claims and reclaims an expired lease after a restart", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const id = await insertEvent(database, TRIP_EVENT);
      const repository = new OutboxRepository(database);
      const start = new Date();

      await expect(repository.claimBatch(start, 10, 1_000)).resolves.toHaveLength(1);
      // A second worker cannot take an event whose lease is still held.
      await expect(
        repository.claimBatch(new Date(start.getTime() + 500), 10, 1_000),
      ).resolves.toHaveLength(0);
      // After a crash the lease expires and exactly one worker may reclaim the same row.
      const reclaimed = await repository.claimBatch(new Date(start.getTime() + 2_000), 10, 1_000);
      expect(reclaimed.map((event) => event.id)).toEqual([id]);
      expect(reclaimed[0]?.attempts).toBe(2);
    });
  });

  it("deduplicates delivery acknowledgements guarded by the delivering state", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const id = await insertEvent(database, TRIP_EVENT);
      const repository = new OutboxRepository(database);
      const now = new Date();
      const publisher = { publish: async () => undefined };

      await expect(deliverOutboxBatch(repository, publisher, { now: () => now })).resolves.toEqual({
        delivered: 1,
        failed: 0,
      });
      // A duplicate acknowledgement cannot overwrite the delivered receipt.
      await repository.markDelivered(id, new Date(now.getTime() + 1_000));
      const row = await database
        .selectFrom("outboxEvents")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      expect(row.deliveryState).toBe("delivered");
      expect(row.deliveredAt).toBeInstanceOf(Date);
      await expect(deliverOutboxBatch(repository, publisher, { now: () => now })).resolves.toEqual({
        delivered: 0,
        failed: 0,
      });
    });
  });

  it("persists consumer receipts across restarts and never reprocesses a delivered event", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const id = await insertEvent(database, TRIP_EVENT);
      const envelope = {
        id,
        eventType: TRIP_EVENT,
        eventVersion: 1,
        aggregateType: "trip",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        payload: { reloadRequired: true },
      };
      const snapshot = { authoritative: true } as never;
      const reload = async () => snapshot;

      const firstStore = new PostgresTripEventReceiptStore(database);
      await expect(consumeTripEvent(envelope, firstStore, reload)).resolves.toEqual({
        duplicate: false,
        snapshot,
      });
      // A fresh store instance (process restart) reads the committed receipt and stays idempotent.
      const restartedStore = new PostgresTripEventReceiptStore(database);
      await expect(consumeTripEvent(envelope, restartedStore, reload)).resolves.toEqual({
        duplicate: true,
      });

      const abandoned = await insertEvent(database, TRIP_EVENT);
      expect(await firstStore.begin(abandoned)).toBe(true);
      await firstStore.abandon(abandoned);
      expect(await firstStore.begin(abandoned)).toBe(true);
    });
  });

  it("fails safely on unknown event types or versions without writing a receipt", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const id = await insertEvent(database, TRIP_EVENT);
      const store = new PostgresTripEventReceiptStore(database);
      const envelope = {
        id,
        eventType: TRIP_EVENT,
        eventVersion: 1,
        aggregateType: "trip",
        aggregateId: randomUUID(),
        aggregateVersion: 1,
        payload: {},
      };

      for (const invalid of [
        { ...envelope, eventType: "trip.version.future" },
        { ...envelope, eventVersion: 2 },
        { ...envelope, unexpected: true },
      ]) {
        await expect(consumeTripEvent(invalid, store, async () => ({}) as never)).rejects.toThrow();
      }
      await expect(
        database
          .selectFrom("tripEventReceipts")
          .select("eventId")
          .where("eventId", "=", id)
          .execute(),
      ).resolves.toHaveLength(0);
    });
  });
});
