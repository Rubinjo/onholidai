import { describe, expect, it, vi } from "vitest";

import {
  consumeTripEvent,
  deliverOutboxBatch,
  type ClaimedOutboxEvent,
} from "../../server/db/outbox";

const event: ClaimedOutboxEvent = {
  id: "30000000-0000-4000-8000-000000000001",
  eventType: "trip.version.committed",
  eventVersion: 1,
  aggregateType: "trip",
  aggregateId: "30000000-0000-4000-8000-000000000002",
  aggregateVersion: 2,
  payload: { reloadRequired: true },
  createdAt: new Date("2026-10-11T12:00:00Z"),
  deliveryState: "delivering",
  attempts: 1,
  nextAttemptAt: new Date("2026-10-11T12:00:00Z"),
  leaseExpiresAt: new Date("2026-10-11T12:00:30Z"),
  deliveredAt: null,
  lastErrorCategory: null,
};

describe("outbox delivery", () => {
  it("publishes with event identity as the idempotency key and marks delivery", async () => {
    const repository = {
      claimBatch: vi.fn(async () => [event]),
      markDelivered: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    const publisher = { publish: vi.fn(async () => undefined) };

    await expect(deliverOutboxBatch(repository, publisher)).resolves.toEqual({
      delivered: 1,
      failed: 0,
    });
    expect(publisher.publish).toHaveBeenCalledWith(event, { idempotencyKey: event.id });
    expect(repository.markDelivered).toHaveBeenCalledWith(event.id, expect.any(Date));
  });

  it("records a bounded retry without persisting raw errors", async () => {
    const repository = {
      claimBatch: vi.fn(async () => [event]),
      markDelivered: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    const publisher = {
      publish: vi.fn(async () => {
        throw new Error("secret supplier response");
      }),
    };

    await expect(deliverOutboxBatch(repository, publisher)).resolves.toEqual({
      delivered: 0,
      failed: 1,
    });
    expect(repository.markFailed).toHaveBeenCalledWith(
      event.id,
      expect.any(Date),
      "delivery_error",
    );
  });
});

describe("trip event consumption", () => {
  it("deduplicates identity and reloads committed state instead of using payload state", async () => {
    const snapshot = { authoritative: true };
    const receipts = {
      begin: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      complete: vi.fn(async () => undefined),
      abandon: vi.fn(async () => undefined),
    };
    const reload = vi.fn(async () => snapshot);
    const envelope = {
      id: event.id,
      eventType: "trip.version.committed",
      eventVersion: 1,
      aggregateType: "trip",
      aggregateId: event.aggregateId,
      aggregateVersion: 2,
      payload: { snapshot: { authoritative: false } },
    };

    const first = await consumeTripEvent(envelope, receipts, reload as never);
    const duplicate = await consumeTripEvent(envelope, receipts, reload as never);

    expect(first).toEqual({ duplicate: false, snapshot });
    expect(duplicate).toEqual({ duplicate: true });
    expect(reload).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledWith(event.aggregateId, 2);
  });

  it("fails safely without consuming unknown event types, versions or unexpected fields", async () => {
    const receipts = {
      begin: vi.fn(async () => true),
      complete: vi.fn(async () => undefined),
      abandon: vi.fn(async () => undefined),
    };
    const reload = vi.fn(async () => ({}));
    const envelope = {
      id: event.id,
      eventType: "trip.version.committed",
      eventVersion: 1,
      aggregateType: "trip",
      aggregateId: event.aggregateId,
      aggregateVersion: 2,
      payload: {},
    };

    for (const invalid of [
      { ...envelope, eventType: "trip.version.future" },
      { ...envelope, eventVersion: 2 },
      { ...envelope, unexpected: true },
      { ...envelope, aggregateVersion: 0 },
    ]) {
      await expect(consumeTripEvent(invalid, receipts as never, reload as never)).rejects.toThrow();
    }
    expect(receipts.begin).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
