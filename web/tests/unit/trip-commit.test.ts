import type { Kysely, Transaction } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { commitTripMutation, TripVersionConflictError } from "../../domain/trip/commit";
import type { Database } from "../../server/db/database";
import { IdempotencyFingerprintConflictError } from "../../server/db/idempotency-repository";
import type { TripRepositoryPort } from "../../server/db/trip-repository";

const ids = {
  trip: "20000000-0000-4000-8000-000000000001",
  request: "20000000-0000-4000-8000-000000000002",
  outbox: "20000000-0000-4000-8000-000000000003",
  audit: "20000000-0000-4000-8000-000000000004",
  window: "20000000-0000-4000-8000-000000000005",
  destination: "20000000-0000-4000-8000-000000000006",
};

function snapshotFixture() {
  const zero = { currency: "USD", minorUnits: 0 };
  return {
    departureOrigin: { kind: "city" as const, placeId: "origin", name: "New York", countryCode: "US", timezone: "America/New_York", airportCode: null, confirmedByUser: true as const },
    availabilityWindows: [{ id: ids.window, startDate: "2027-04-01", endDate: "2027-04-10", preference: "preferred" as const, timezone: "America/New_York" }],
    duration: { minimumDays: 5, idealDays: 7, maximumDays: 9 },
    travellerParty: { adults: 2, children: [] },
    preferences: { pace: 50, spend: 50, discovery: 50, independence: 50, setting: 50 },
    constraints: [],
    destinations: [{ id: ids.destination, kind: "city" as const, name: "Lisbon", countryCode: "PT", providerPlaceIds: {}, location: null, routePosition: 0, arrivalDate: null, departureDate: null, plannedNights: 0 }],
    itineraryDays: [], components: [],
    price: { currency: "USD", supplierTotal: zero, platformMarginTotal: zero, customerPayableTaxesTotal: zero, customerPayableFeesTotal: zero, finalCustomerTotal: zero, status: "estimated" as const, checkedAt: "2026-10-11T12:00:00Z", conversionDisclosures: [] },
    warnings: [],
  };
}

function command() {
  return {
    tripId: ids.trip,
    ownerUserId: "owner-user",
    expectedVersion: 1,
    requestId: ids.request,
    idempotencyKey: "request-1",
    requestFingerprint: "a".repeat(64),
    snapshot: snapshotFixture(),
    initiatingActor: "user" as const,
    proposalId: null,
    changeSummary: ["destinations"],
    inverseOperation: { operation: "replace" as const, target: "/destinations", value: [] },
    nonReversibleReason: null,
    outboxEventId: ids.outbox,
    auditEventId: ids.audit,
    traceId: null,
  };
}

function harness(overrides: { currentVersion?: number; advanced?: boolean; replay?: Record<string, unknown>; claimError?: Error } = {}) {
  const transaction = {} as Transaction<Database>;
  const execute = vi.fn(async (callback: (trx: Transaction<Database>) => Promise<unknown>) => callback(transaction));
  const database = { transaction: () => ({ execute }) } as unknown as Kysely<Database>;
  const idempotency = {
    claim: vi.fn(async () => {
      if (overrides.claimError) throw overrides.claimError;
      return overrides.replay ? { kind: "replay" as const, result: overrides.replay } : { kind: "claimed" as const };
    }),
    complete: vi.fn(async () => undefined),
  };
  const trips: TripRepositoryPort = {
    lockTrip: vi.fn(async () => ({ id: ids.trip, ownerUserId: "owner-user", currentVersion: overrides.currentVersion ?? 1, currency: "USD" })),
    insertVersion: vi.fn(async () => undefined),
    advanceCurrentVersion: vi.fn(async () => overrides.advanced ?? true),
    appendOutbox: vi.fn(async () => undefined),
    appendAudit: vi.fn(async () => undefined),
  };
  return { database, execute, idempotency, trips };
}

describe("authoritative trip commit", () => {
  it("writes version, pointer, safe event, audit, and idempotency result in one transaction", async () => {
    const test = harness();
    const result = await commitTripMutation(test.database, command(), {
      now: () => new Date("2026-10-11T12:00:00Z"),
      repositoryFactory: () => ({ idempotency: test.idempotency, trips: test.trips }),
    });

    expect(result).toMatchObject({ version: 2, previousVersion: 1, replayed: false });
    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.trips.insertVersion).toHaveBeenCalledOnce();
    expect(test.trips.advanceCurrentVersion).toHaveBeenCalledWith(ids.trip, 1, 2, "USD", expect.any(Date));
    expect(test.trips.appendOutbox).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.not.objectContaining({ snapshot: expect.anything() }) }));
    expect(test.idempotency.complete).toHaveBeenCalledOnce();
  });

  it("returns an exact completed replay without writing trip state", async () => {
    const replay = { tripId: ids.trip, previousVersion: 1, version: 2, outboxEventId: ids.outbox, replayed: false };
    const test = harness({ replay });
    const result = await commitTripMutation(test.database, command(), { repositoryFactory: () => ({ idempotency: test.idempotency, trips: test.trips }) });

    expect(result.replayed).toBe(true);
    expect(test.trips.lockTrip).not.toHaveBeenCalled();
  });

  it("rejects a reused idempotency key with a different fingerprint before writes", async () => {
    const test = harness({ claimError: new IdempotencyFingerprintConflictError() });
    await expect(commitTripMutation(test.database, command(), { repositoryFactory: () => ({ idempotency: test.idempotency, trips: test.trips }) })).rejects.toMatchObject({ code: "idempotency_fingerprint_conflict" });
    expect(test.trips.insertVersion).not.toHaveBeenCalled();
  });

  it("rejects stale or conditionally lost updates", async () => {
    const stale = harness({ currentVersion: 2 });
    await expect(commitTripMutation(stale.database, command(), { repositoryFactory: () => ({ idempotency: stale.idempotency, trips: stale.trips }) })).rejects.toBeInstanceOf(TripVersionConflictError);

    const lost = harness({ advanced: false });
    await expect(commitTripMutation(lost.database, command(), { repositoryFactory: () => ({ idempotency: lost.idempotency, trips: lost.trips }) })).rejects.toBeInstanceOf(TripVersionConflictError);
    expect(lost.idempotency.complete).not.toHaveBeenCalled();
  });
});