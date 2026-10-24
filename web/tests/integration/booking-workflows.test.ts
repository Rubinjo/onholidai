// @vitest-environment node
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import { NativeConnection, Worker } from "@temporalio/worker";
import { Pool } from "pg";
import { sql } from "kysely";

import { commitTripMutation } from "../../domain/trip/commit";
import { inTransaction } from "../../server/db/transaction";
import { BookingRepository } from "../../server/db/booking-repository";
import { startComponentRescheduleRevalidation } from "../../domain/booking/reschedule";
import { authorizeBooking } from "../../domain/booking/authorize";
import { startBooking } from "../../domain/booking/start";
import {
  bookingTermsV2Schema,
  canonicalBookingJson,
  hashBookingTerms,
} from "../../domain/booking/authorization";
import { tripSnapshotSchema, type TripSnapshot } from "../../domain/trip/schema";
import {
  TransactionProviderRegistry,
  type ProviderTransactionAdapter,
  type ProviderWriteRequest,
  type TransactionOutcome,
} from "../../server/supply/transactions";
import { createBookingActivities } from "../../server/workflows/activities";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
import { withTemporalTestEnvironment } from "../helpers/temporal";
import {
  seedAuthorizedBooking,
  seedReviewedWholeTrip,
  type SeededBooking,
} from "../helpers/booking";
import { lockBookingEvidenceTrip } from "../../server/auth/booking-access";

import type { Database } from "../../server/db/database";
import type { Kysely } from "kysely";

vi.mock("server-only", () => ({}));

const workflowsPath = fileURLToPath(new URL("../../server/workflows/index.ts", import.meta.url));
const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;

type Provider = ProviderTransactionAdapter["provider"];

interface Behaviour {
  execute?: (request: ProviderWriteRequest) => TransactionOutcome | Promise<TransactionOutcome>;
  status?: () => TransactionOutcome | Promise<TransactionOutcome>;
  revalidate?: (
    request: Parameters<NonNullable<ProviderTransactionAdapter["revalidate"]>>[0],
  ) => Awaited<ReturnType<NonNullable<ProviderTransactionAdapter["revalidate"]>>>;
}

interface ProviderScript {
  duffel?: Behaviour;
  trainline?: Behaviour;
  booking?: Behaviour;
  getyourguide?: Behaviour;
}

function createProviders(scripts: ProviderScript, calls: Record<string, number>) {
  const registry = new TransactionProviderRegistry();
  const register = (provider: Provider, behaviour: Behaviour | undefined) => {
    if (!behaviour) return;
    registry.register({
      provider,
      capabilities: { book: true, status: true, cancel: true, reschedule: true, idempotency: true },
      async execute(request) {
        const key = `execute:${request.componentId}`;
        calls[key] = (calls[key] ?? 0) + 1;
        if (!behaviour.execute) throw new Error("Provider write is not scripted");
        return behaviour.execute(request);
      },
      async getStatus() {
        calls.status = (calls.status ?? 0) + 1;
        if (!behaviour.status) throw new Error("Provider status is not scripted");
        return behaviour.status();
      },
      ...(behaviour.revalidate
        ? {
            revalidate: async (
              request: Parameters<NonNullable<ProviderTransactionAdapter["revalidate"]>>[0],
            ) => behaviour.revalidate!(request),
          }
        : {}),
    } satisfies ProviderTransactionAdapter);
  };
  register("duffel", scripts.duffel);
  register("trainline", scripts.trainline);
  register("booking", scripts.booking);
  register("getyourguide", scripts.getyourguide);
  return registry;
}

const confirmedWith =
  (reference: string) =>
  (request: ProviderWriteRequest): TransactionOutcome => ({
    status: "confirmed",
    providerReference: reference,
    evidenceId: `${reference}-evidence`,
    confirmedTerms: request.terms,
  });

function componentIdFor(
  seeded: SeededBooking,
  type: TripSnapshot["components"][number]["type"],
): string {
  const component = seeded.snapshot.components.find((entry) => entry.type === type);
  if (!component) throw new Error(`Missing ${type} component`);
  return component.id;
}

async function runSaga(
  database: Kysely<Database>,
  providers: TransactionProviderRegistry,
  transactionId: string,
) {
  let result: { transactionId: string; status: string } | undefined;
  await withTemporalTestEnvironment(async (environment) => {
    const connection = await NativeConnection.connect({ address: environment.address });
    try {
      const worker = await Worker.create({
        connection,
        taskQueue: "onholidai-booking-test",
        workflowsPath,
        activities: createBookingActivities(database, providers),
      });
      await worker.runUntil(async () => {
        result = await environment.client.workflow.execute("bookTrip", {
          taskQueue: "onholidai-booking-test",
          workflowId: `booking-${transactionId}`,
          args: [{ transactionId }],
        });
      });
    } finally {
      await connection.close();
    }
  });
  return result!;
}

async function readTransaction(database: Kysely<Database>, transactionId: string) {
  const row = await database
    .selectFrom("bookingTransactions")
    .selectAll()
    .where("id", "=", transactionId)
    .executeTakeFirstOrThrow();
  return row;
}

async function freshAttemptForSameTrip(database: Kysely<Database>, seeded: SeededBooking) {
  const original = seeded.transaction!;
  const authorizationId = randomUUID(),
    transactionId = randomUUID();
  const candidate = {
    ...original,
    id: transactionId,
    authorizationId,
    requestId: randomUUID(),
    workflowId: `booking-${transactionId}`,
    executionBasis: { ...original.executionBasis, authorizationId },
  };
  await inTransaction(database, async (transaction) => {
    const repository = new BookingRepository(transaction);
    await repository.insertAuthorization({
      id: authorizationId,
      tripId: seeded.tripId,
      userId: seeded.userId,
      tripVersion: seeded.tripVersion,
      operation: "book_trip",
      componentId: null,
      terms: seeded.terms,
      termsHash: original.executionBasis.termsHash,
      acknowledgedNonReversibleActions: [],
      status: "authorized",
      reason: null,
      authorizedAt: new Date().toISOString(),
      expiresAt: original.executionBasis.expiresAt,
    });
    expect(
      await repository.startTransaction({ transaction: candidate, ownerUserId: seeded.userId }),
    ).toBe(true);
  });
  return candidate;
}

describeWithDatabase("booking workflow durability", () => {
  it.each(["claimed", "unknown", "confirmed"] as const)(
    "guards the same v2 requirement under a different component and authorization when %s",
    async (priorStatus) => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const now = new Date();
        const seed = await seedReviewedWholeTrip(database, undefined, "completed", undefined, now);
        const authorization = await authorizeBooking(
          database,
          seed.userId,
          seed.tripId,
          seed.request,
          now,
          seed.prerequisites,
        );
        const original = await startBooking(
          database,
          seed.userId,
          seed.tripId,
          {
            requestId: randomUUID(),
            authorizationId: authorization.id,
          },
          { now, prerequisites: seed.prerequisites },
        );
        const originalTerms = bookingTermsV2Schema.parse(original.executionBasis.terms);
        const first = originalTerms.components.find(
          (entry) => entry.service.type === "accommodation",
        )!;
        const componentId = randomUUID(),
          authorizationId = randomUUID(),
          transactionId = randomUUID();
        const terms = bookingTermsV2Schema.parse({
          ...originalTerms,
          continuationOf: original.id,
          rootAttemptId: original.id,
          components: originalTerms.components.map((entry) =>
            entry.componentId === first.componentId
              ? { ...entry, componentId, evidence: { ...entry.evidence, componentId } }
              : entry,
          ),
          coverage: {
            ...originalTerms.coverage,
            toBookComponentIds: originalTerms.coverage.toBookComponentIds.map((id) =>
              id === first.componentId ? componentId : id,
            ),
            entries: originalTerms.coverage.entries.map((entry) => ({
              ...entry,
              componentIds: entry.componentIds.map((id) =>
                id === first.componentId ? componentId : id,
              ),
            })),
          },
        });
        const candidate = {
          ...original,
          id: transactionId,
          authorizationId,
          requestId: randomUUID(),
          workflowId: `booking-${transactionId}`,
          executionBasis: {
            ...original.executionBasis,
            authorizationId,
            terms,
            termsHash: hashBookingTerms(terms),
          },
          components: original.components.map((entry) =>
            entry.componentId === first.componentId ? { ...entry, componentId } : entry,
          ),
        };
        await inTransaction(database, async (transaction) => {
          const repository = new BookingRepository(transaction);
          await repository.insertAuthorization(
            {
              id: authorizationId,
              tripId: seed.tripId,
              userId: seed.userId,
              tripVersion: seed.tripVersion,
              operation: "book_trip",
              componentId: null,
              terms,
              termsHash: hashBookingTerms(terms),
              acknowledgedNonReversibleActions: [],
              status: "authorized",
              reason: null,
              authorizedAt: now.toISOString(),
              expiresAt: original.executionBasis.expiresAt,
            },
            { requestId: randomUUID(), requestFingerprint: "d".repeat(64) },
          );
          await repository.startTransaction({ transaction: candidate, ownerUserId: seed.userId });
          // Repository-only fixtures exercise guards; stock activities still refuse all v2 dispatch.
          await transaction
            .updateTable("bookingTransactions")
            .set({ executionStatus: "active" })
            .where("id", "in", [original.id, candidate.id])
            .execute();
        });
        const identity = (booking: typeof original, entry: typeof first) => ({
          idempotencyKey: `${booking.id}:${entry.componentId}:book_trip:${booking.executionBasis.termsHash}`,
          requestFingerprint: createHash("sha256")
            .update(canonicalBookingJson({ operation: "book_trip", terms: entry }))
            .digest("hex"),
        });
        const firstIdentity = identity(original, first);
        const claim = (booking: typeof original, entry: typeof first, expectedVersion: number) =>
          inTransaction(database, async (transaction) => {
            await lockBookingEvidenceTrip(transaction, seed.tripId);
            return new BookingRepository(transaction).claimComponentWrite({
              tripId: seed.tripId,
              transactionId: booking.id,
              componentId: entry.componentId,
              attemptId: randomUUID(),
              expectedVersion,
              operation: "book_trip",
              ...identity(booking, entry),
              requirementIds: entry.evidence.requirementIds,
              expiresAt: new Date(booking.executionBasis.expiresAt),
              now,
            });
          });
        expect(await claim(original, first, seed.tripVersion)).toBe(true);
        if (priorStatus === "unknown") {
          await database
            .updateTable("bookingWriteClaims")
            .set({ state: "unknown" })
            .where("transactionId", "=", original.id)
            .execute();
          await database
            .updateTable("bookingComponentAttempts")
            .set({ status: "unknown" })
            .where("transactionId", "=", original.id)
            .execute();
        }
        if (priorStatus === "confirmed") {
          await database
            .updateTable("bookingComponentAttempts")
            .set({ status: "dispatched" })
            .where("transactionId", "=", original.id)
            .execute();
          await inTransaction(database, (transaction) =>
            new BookingRepository(transaction).recordProviderEvidence({
              transactionId: original.id,
              componentId: first.componentId,
              ...firstIdentity,
              result: {
                status: "confirmed",
                providerReference: "guarded-stay",
                evidenceId: "recorded-stay-evidence",
                confirmedTerms: first,
              },
              reconciled: false,
              now,
            }),
          );
        }
        const current = await database
          .selectFrom("trips")
          .select("currentVersion")
          .where("id", "=", seed.tripId)
          .executeTakeFirstOrThrow();
        await database
          .updateTable("bookingTransactions")
          .set({ lastObservedTripVersion: current.currentVersion })
          .where("id", "=", candidate.id)
          .execute();
        expect(
          await claim(
            candidate,
            terms.components.find((entry) => entry.componentId === componentId)!,
            current.currentVersion,
          ),
        ).toBe(false);
        expect(
          await database
            .selectFrom("bookingComponentAttempts")
            .select("id")
            .where("transactionId", "=", candidate.id)
            .execute(),
        ).toEqual([]);
      });
    },
    120_000,
  );

  it("keeps an expired uncertain action blocked when status support is unavailable", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight");
      const calls: Record<string, number> = {};
      const providers = createProviders(
        {
          duffel: {
            execute: () => {
              throw new Error("timeout after possible commit");
            },
            status: () => {
              throw new Error("This status method must not run");
            },
          },
        },
        calls,
      );
      const activities = createBookingActivities(database, providers);
      const claim = await activities.claimProviderWrite(seeded.transaction!.id, flightId);
      await activities.executeProviderWrite(
        seeded.transaction!.id,
        flightId,
        claim.idempotencyKey,
        claim.requestFingerprint,
      );
      providers.get("duffel")!.capabilities.status = false;
      providers.get("duffel")!.capabilities.book = false;
      await database
        .updateTable("bookingTransactions")
        .set({ executionStatus: "expired" })
        .where("id", "=", seeded.transaction!.id)
        .execute();
      expect(
        await activities.reconcileProviderStatus(seeded.transaction!.id, flightId),
      ).toMatchObject({
        status: "action_required",
        safeReason: expect.stringContaining("manual status confirmation"),
      });
      expect(calls[`execute:${flightId}`]).toBe(1);
      expect(calls.status).toBeUndefined();
      expect(
        await database
          .selectFrom("bookingWriteClaims")
          .select("state")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([{ state: "unknown" }]);
      expect((await readTransaction(database, seeded.transaction!.id)).executionStatus).toBe(
        "expired",
      );
    });
  }, 120_000);

  it("checks expiry again after claiming and before dispatching a provider action", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight");
      const calls: Record<string, number> = {};
      const activities = createBookingActivities(
        database,
        createProviders({ duffel: { execute: confirmedWith("must-not-be-booked") } }, calls),
      );
      const claim = await activities.claimProviderWrite(seeded.transaction!.id, flightId);
      const clock = vi
        .spyOn(Date, "now")
        .mockReturnValue(Date.parse(seeded.transaction!.executionBasis.expiresAt) + 1);
      try {
        await expect(
          activities.executeProviderWrite(
            seeded.transaction!.id,
            flightId,
            claim.idempotencyKey,
            claim.requestFingerprint,
          ),
        ).rejects.toThrow("expired");
      } finally {
        clock.mockRestore();
      }
      expect(calls).toEqual({});
      expect((await readTransaction(database, seeded.transaction!.id)).executionStatus).toBe(
        "expired",
      );
      expect(
        await database
          .selectFrom("bookingComponentAttempts")
          .select("status")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([{ status: "claimed" }]);
      expect(
        await database
          .selectFrom("bookingWriteClaims")
          .select("attemptId")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
    });
  }, 120_000);

  it("keeps conflicting provider evidence append-only and never resets a dispatched attempt", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight");
      const terms = seeded.terms.components.find((entry) => entry.componentId === flightId)!;
      let checks = 0;
      const activities = createBookingActivities(
        database,
        createProviders(
          {
            duffel: {
              execute: () => ({ status: "unknown", safeReason: "Possible commit" }),
              status: () => ({
                status: "confirmed",
                providerReference: ++checks === 1 ? "original-flight" : "conflicting-flight",
                evidenceId: "authenticated-evidence",
                confirmedTerms: terms,
              }),
            },
          },
          {},
        ),
      );
      const claim = await activities.claimProviderWrite(seeded.transaction!.id, flightId);
      await activities.executeProviderWrite(
        seeded.transaction!.id,
        flightId,
        claim.idempotencyKey,
        claim.requestFingerprint,
      );
      await activities.reconcileProviderStatus(seeded.transaction!.id, flightId);
      expect(
        await activities.reconcileProviderStatus(seeded.transaction!.id, flightId),
      ).toMatchObject({
        status: "action_required",
        providerReference: "original-flight",
      });
      const attempt = await database
        .selectFrom("bookingComponentAttempts")
        .selectAll()
        .where("transactionId", "=", seeded.transaction!.id)
        .executeTakeFirstOrThrow();
      expect(attempt.providerEvidence).toHaveLength(3);
      expect(attempt.evidenceConflict).toBe(true);
      await expect(
        database
          .updateTable("bookingComponentAttempts")
          .set({ evidenceConflict: false })
          .where("id", "=", attempt.id)
          .execute(),
      ).rejects.toThrow("append-only");
      await expect(
        database
          .updateTable("bookingComponentAttempts")
          .set({ providerEvidence: sql<unknown[]>`'[]'::jsonb` })
          .where("id", "=", attempt.id)
          .execute(),
      ).rejects.toThrow("append-only");
      await expect(
        database
          .updateTable("bookingComponentAttempts")
          .set({ requirementIds: ["different-requirement"] })
          .where("id", "=", attempt.id)
          .execute(),
      ).rejects.toThrow("append-only");
      await expect(
        database
          .updateTable("bookingComponentAttempts")
          .set({ status: "claimed" })
          .where("id", "=", attempt.id)
          .execute(),
      ).rejects.toThrow("cannot be reclaimed");
      await activities.reconcileProviderStatus(seeded.transaction!.id, flightId);
      expect(
        (
          await database
            .selectFrom("bookingComponentAttempts")
            .select("providerEvidence")
            .where("id", "=", attempt.id)
            .executeTakeFirstOrThrow()
        ).providerEvidence,
      ).toHaveLength(3);
    });
  }, 120_000);

  it.each(["dispatched", "unknown", "confirmed"] as const)(
    "blocks a fresh authorization/key while a prior component is %s",
    async (priorStatus) => {
      await withIsolatedTestDatabase(async ({ database }) => {
        const seeded = await seedAuthorizedBooking(database);
        const flightId = componentIdFor(seeded, "flight");
        const calls: Record<string, number> = {};
        const providers = createProviders(
          {
            duffel: {
              execute:
                priorStatus === "confirmed"
                  ? confirmedWith("prior-flight")
                  : () => ({ status: "unknown", safeReason: "Possible supplier commit" }),
            },
          },
          calls,
        );
        const activities = createBookingActivities(database, providers);
        const first = await activities.claimProviderWrite(seeded.transaction!.id, flightId);
        if (priorStatus === "dispatched")
          await database
            .updateTable("bookingComponentAttempts")
            .set({ status: "dispatched" })
            .where("transactionId", "=", seeded.transaction!.id)
            .execute();
        else
          await activities.executeProviderWrite(
            seeded.transaction!.id,
            flightId,
            first.idempotencyKey,
            first.requestFingerprint,
          );
        const next = await freshAttemptForSameTrip(database, seeded);
        const current = await database
          .selectFrom("trips")
          .select("currentVersion")
          .where("id", "=", seeded.tripId)
          .executeTakeFirstOrThrow();
        await database
          .updateTable("bookingTransactions")
          .set({ lastObservedTripVersion: current.currentVersion })
          .where("id", "=", next.id)
          .execute();
        const repeated = await activities.claimProviderWrite(next.id, flightId);
        expect(repeated.allowed).toBe(false);
        expect(repeated.idempotencyKey).not.toBe(first.idempotencyKey);
        expect(
          await database
            .selectFrom("bookingComponentAttempts")
            .select("id")
            .where("transactionId", "=", next.id)
            .execute(),
        ).toEqual([]);
        expect(calls[`execute:${flightId}`] ?? 0).toBe(priorStatus === "dispatched" ? 0 : 1);
      });
    },
    120_000,
  );

  it("allows at most one provider dispatch across 100 concurrent deliveries of a durable claim", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const calls: Record<string, number> = {};
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight");
      const providers = createProviders(
        { duffel: { execute: confirmedWith("one-flight") } },
        calls,
      );
      const activities = createBookingActivities(database, providers);
      const claim = await activities.claimProviderWrite(seeded.transaction!.id, flightId);
      expect(claim.allowed).toBe(true);
      await Promise.allSettled(
        Array.from({ length: 100 }, () =>
          activities.executeProviderWrite(
            seeded.transaction!.id,
            flightId,
            claim.idempotencyKey,
            claim.requestFingerprint,
          ),
        ),
      );
      expect(calls[`execute:${flightId}`]).toBe(1);
      const confirmations = await database
        .selectFrom("bookingConfirmations")
        .select("providerReference")
        .where("transactionId", "=", seeded.transaction!.id)
        .execute();
      expect(confirmations).toEqual([{ providerReference: "one-flight" }]);
    });
  }, 120_000);

  it("records a late confirmation after expiry without overwriting an unrelated trip version", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight");
      const activities = createBookingActivities(
        database,
        createProviders(
          {
            duffel: {
              execute: async (request) => {
                await database
                  .updateTable("bookingTransactions")
                  .set({ executionStatus: "expired", status: "action_required" })
                  .where("id", "=", seeded.transaction!.id)
                  .execute();
                return confirmedWith("late-flight")(request);
              },
            },
          },
          {},
        ),
      );
      const claim = await activities.claimProviderWrite(seeded.transaction!.id, flightId);
      const outcome = await activities.executeProviderWrite(
        seeded.transaction!.id,
        flightId,
        claim.idempotencyKey,
        claim.requestFingerprint,
      );
      await activities.recordBookingOutcome(seeded.transaction!.id, outcome);
      const saved = await readTransaction(database, seeded.transaction!.id);
      expect(saved.components).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            componentId: flightId,
            status: "confirmed",
            providerReference: "late-flight",
          }),
        ]),
      );
      expect(saved.executionStatus).not.toBe("active");
    });
  }, 120_000);

  it("retains the dispatched guard across a database crash before outcome projection and recovers without another write", async () => {
    await withIsolatedTestDatabase(async ({ database, adminConnectionString }) => {
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight");
      const terms = seeded.terms.components.find((entry) => entry.componentId === flightId)!;
      const calls: Record<string, number> = {};
      const providers = createProviders(
        {
          duffel: {
            execute: confirmedWith("crash-window-flight"),
            status: () => ({
              status: "confirmed",
              providerReference: "crash-window-flight",
              evidenceId: "recovered-evidence",
              confirmedTerms: terms,
            }),
          },
        },
        calls,
      );
      const activities = createBookingActivities(database, providers);
      const claim = await activities.claimProviderWrite(seeded.transaction!.id, flightId);
      const admin = new Pool({ connectionString: adminConnectionString, max: 1 });
      try {
        await admin.query(`
          CREATE FUNCTION app.us4_crash_before_projection() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'synthetic crash before projection'; END $$;
          CREATE TRIGGER us4_crash_before_projection BEFORE UPDATE ON app.booking_transactions
          FOR EACH ROW EXECUTE FUNCTION app.us4_crash_before_projection();
        `);
        await expect(
          activities.executeProviderWrite(
            seeded.transaction!.id,
            flightId,
            claim.idempotencyKey,
            claim.requestFingerprint,
          ),
        ).rejects.toThrow("synthetic crash before projection");
        expect(calls[`execute:${flightId}`]).toBe(1);
        expect(
          await database
            .selectFrom("bookingConfirmations")
            .select("id")
            .where("tripId", "=", seeded.tripId)
            .execute(),
        ).toEqual([]);
        expect(
          await database
            .selectFrom("bookingComponentAttempts")
            .select("status")
            .where("tripId", "=", seeded.tripId)
            .execute(),
        ).toEqual([{ status: "dispatched" }]);
        expect(
          await database
            .selectFrom("bookingWriteClaims")
            .select("componentId")
            .where("tripId", "=", seeded.tripId)
            .execute(),
        ).toEqual([{ componentId: flightId }]);
        await admin.query(
          "DROP TRIGGER us4_crash_before_projection ON app.booking_transactions; DROP FUNCTION app.us4_crash_before_projection()",
        );
        const restarted = createBookingActivities(database, providers);
        expect(
          await restarted.reconcileProviderStatus(seeded.transaction!.id, flightId),
        ).toMatchObject({ status: "confirmed", providerReference: "crash-window-flight" });
        await restarted.executeProviderWrite(
          seeded.transaction!.id,
          flightId,
          claim.idempotencyKey,
          claim.requestFingerprint,
        );
        expect(calls[`execute:${flightId}`]).toBe(1);
        expect(
          await database
            .selectFrom("bookingConfirmations")
            .select("providerReference")
            .where("tripId", "=", seeded.tripId)
            .execute(),
        ).toEqual([{ providerReference: "crash-window-flight" }]);
      } finally {
        await admin.end();
      }
    });
  }, 120_000);

  it("persists confirmed-but-changed provider terms and retains the duplicate guard", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight");
      const activities = createBookingActivities(
        database,
        createProviders(
          {
            duffel: {
              execute: (request) => ({
                status: "confirmed",
                providerReference: "changed-flight",
                evidenceId: "changed-evidence",
                confirmedTerms: {
                  ...request.terms,
                  finalCustomerMinor: request.terms.finalCustomerMinor + 500,
                },
              }),
            },
          },
          {},
        ),
      );
      const claim = await activities.claimProviderWrite(seeded.transaction!.id, flightId);
      const outcome = await activities.executeProviderWrite(
        seeded.transaction!.id,
        flightId,
        claim.idempotencyKey,
        claim.requestFingerprint,
      );
      expect(outcome).toMatchObject({
        status: "action_required",
        providerReference: "changed-flight",
      });
      expect(
        await database
          .selectFrom("bookingConfirmations")
          .select(["providerReference", "terms"])
          .where("transactionId", "=", seeded.transaction!.id)
          .execute(),
      ).toEqual([expect.objectContaining({ providerReference: "changed-flight" })]);
      expect(
        await database
          .selectFrom("bookingWriteClaims")
          .select("state")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([{ state: "unknown" }]);
    });
  }, 120_000);

  it("performs one provider action per durable key and keeps a post-commit timeout unknown", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const calls: Record<string, number> = {};
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight"),
        railId = componentIdFor(seeded, "rail");
      const providers = createProviders(
        {
          duffel: { execute: confirmedWith("duffel-flight") },
          trainline: { execute: confirmedWith("trainline-rail") },
          booking: {
            execute: () => {
              throw new Error("timeout after commit");
            },
          },
        },
        calls,
      );

      const result = await runSaga(database, providers, seeded.transaction!.id);

      expect(result.status).toBe("action_required");
      expect(calls[`execute:${flightId}`]).toBe(1);
      expect(calls[`execute:${railId}`]).toBe(1);
      const transaction = await readTransaction(database, seeded.transaction!.id);
      const statuses = Object.fromEntries(
        (transaction.components as Array<{ componentId: string; status: string }>).map(
          (component) => [component.componentId, component.status],
        ),
      );
      expect(statuses[flightId]).toBe("confirmed");
      expect(statuses[railId]).toBe("confirmed");
      expect(Object.values(statuses)).toContain("unknown");
      const attempts = await database
        .selectFrom("bookingComponentAttempts")
        .select(["componentId", "status", "idempotencyKey"])
        .where("transactionId", "=", seeded.transaction!.id)
        .execute();
      expect(attempts).toHaveLength(3);
      expect(attempts.filter((attempt) => attempt.status === "unknown")).toHaveLength(1);
      const claims = await database
        .selectFrom("bookingWriteClaims")
        .selectAll()
        .where("tripId", "=", seeded.tripId)
        .execute();
      expect(claims).toHaveLength(1);
      expect(claims[0].state).toBe("unknown");
      const confirmations = await database
        .selectFrom("bookingConfirmations")
        .select("componentId")
        .where("transactionId", "=", seeded.transaction!.id)
        .execute();
      expect(confirmations.map((entry) => entry.componentId).sort()).toEqual(
        [flightId, railId].sort(),
      );
    });
  }, 120_000);

  it("replays a completed transaction without repeating provider writes", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const calls: Record<string, number> = {};
      const seeded = await seedAuthorizedBooking(database);
      const flightId = componentIdFor(seeded, "flight");
      const providers = createProviders(
        {
          duffel: { execute: confirmedWith("duffel-flight") },
          trainline: {
            execute: () => {
              throw new Error("timeout after commit");
            },
          },
        },
        calls,
      );

      const first = await runSaga(database, providers, seeded.transaction!.id);
      const writesAfterFirst = calls[`execute:${flightId}`];
      const versionsAfterFirst = await database
        .selectFrom("tripVersions")
        .select("version")
        .where("tripId", "=", seeded.tripId)
        .execute();
      const second = await runSaga(database, providers, seeded.transaction!.id);

      expect(second.status).toBe(first.status);
      expect(calls[`execute:${flightId}`]).toBe(writesAfterFirst);
      expect(
        await database
          .selectFrom("tripVersions")
          .select("version")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual(versionsAfterFirst);
      expect(
        await database
          .selectFrom("bookingConfirmations")
          .select("componentId")
          .where("transactionId", "=", seeded.transaction!.id)
          .execute(),
      ).toHaveLength(1);
    });
  }, 120_000);

  it("keeps unrelated confirmations when one action fails and releases its claim", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const calls: Record<string, number> = {};
      const seeded = await seedAuthorizedBooking(database);
      const railId = componentIdFor(seeded, "rail"),
        stayId = componentIdFor(seeded, "accommodation");
      const providers = createProviders(
        {
          duffel: { execute: confirmedWith("duffel-flight") },
          trainline: {
            execute: () => ({ status: "failed", safeReason: "Synthetic provider failure" }),
          },
          booking: { execute: confirmedWith("booking-stay") },
        },
        calls,
      );

      const result = await runSaga(database, providers, seeded.transaction!.id);

      expect(result.status).toBe("partially_confirmed");
      expect(calls[`execute:${railId}`]).toBe(1);
      expect(calls[`execute:${stayId}`]).toBe(1);
      const transaction = await readTransaction(database, seeded.transaction!.id);
      const statuses = transaction.components as Array<{ componentId: string; status: string }>;
      expect(statuses.find((component) => component.componentId === railId)?.status).toBe("failed");
      expect(statuses.find((component) => component.componentId === stayId)?.status).toBe(
        "confirmed",
      );
      expect(
        await database
          .selectFrom("bookingWriteClaims")
          .select("componentId")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
    });
  }, 120_000);

  it("stops pending actions when the trip version advances outside the booking transaction", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const calls: Record<string, number> = {};
      const seeded = await seedAuthorizedBooking(database);
      const providers = createProviders(
        {
          duffel: { execute: confirmedWith("duffel-flight") },
          trainline: { execute: confirmedWith("trainline-rail") },
          booking: { execute: confirmedWith("booking-stay") },
        },
        calls,
      );

      const stored = await database
        .selectFrom("tripVersions")
        .selectAll()
        .where("tripId", "=", seeded.tripId)
        .where("version", "=", seeded.tripVersion)
        .executeTakeFirstOrThrow();
      await commitTripMutation(database, {
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        expectedVersion: seeded.tripVersion,
        requestId: randomUUID(),
        idempotencyKey: `external-edit:${seeded.tripId}`,
        requestFingerprint: "b".repeat(64),
        snapshot: tripSnapshotSchema.parse(stored.snapshot),
        initiatingActor: "user",
        proposalId: null,
        changeSummary: ["external_material_change"],
        inverseOperation: { operation: "replace", target: "/", value: stored.snapshot },
        nonReversibleReason: null,
        outboxEventId: randomUUID(),
        auditEventId: randomUUID(),
      });

      const result = await runSaga(database, providers, seeded.transaction!.id);

      expect(result.status).toBe("action_required");
      expect(calls).toEqual({});
      const transaction = await readTransaction(database, seeded.transaction!.id);
      expect(transaction.executionStatus).toBe("invalidated");
      expect(
        await database
          .selectFrom("bookingConfirmations")
          .select("componentId")
          .where("transactionId", "=", seeded.transaction!.id)
          .execute(),
      ).toEqual([]);
    });
  }, 120_000);

  it("reconciles an unknown outcome through provider status without repeating the write", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const calls: Record<string, number> = {};
      const seeded = await seedAuthorizedBooking(database);
      const stayId = componentIdFor(seeded, "accommodation");
      const authorizedStay = seeded.terms.components.find(
        (component) => component.componentId === stayId,
      )!;
      const providers = createProviders(
        {
          duffel: { execute: confirmedWith("duffel-flight") },
          trainline: { execute: confirmedWith("trainline-rail") },
          booking: {
            execute: () => {
              throw new Error("timeout after commit");
            },
            status: () => ({
              status: "confirmed",
              providerReference: "booking-stay",
              evidenceId: "booking-evidence",
              confirmedTerms: authorizedStay,
            }),
          },
        },
        calls,
      );
      const activities = createBookingActivities(database, providers);

      await runSaga(database, providers, seeded.transaction!.id);
      const reconciled = await activities.reconcileProviderStatus(seeded.transaction!.id, stayId);

      expect(reconciled.status).toBe("confirmed");
      expect(calls[`execute:${stayId}`]).toBe(1);
      const attempts = await database
        .selectFrom("bookingComponentAttempts")
        .select(["componentId", "status"])
        .where("transactionId", "=", seeded.transaction!.id)
        .execute();
      expect(attempts.find((attempt) => attempt.componentId === stayId)?.status).toBe("reconciled");
      expect(
        await database
          .selectFrom("bookingWriteClaims")
          .select("componentId")
          .where("tripId", "=", seeded.tripId)
          .execute(),
      ).toEqual([]);
      expect(
        (
          await database
            .selectFrom("bookingConfirmations")
            .select("componentId")
            .where("transactionId", "=", seeded.transaction!.id)
            .execute()
        )
          .map((entry) => entry.componentId)
          .sort(),
      ).toEqual([componentIdFor(seeded, "flight"), componentIdFor(seeded, "rail"), stayId].sort());
    });
  }, 120_000);

  it("preserves existing evidence when reconciled provider terms contradict the authorization", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const calls: Record<string, number> = {};
      const seeded = await seedAuthorizedBooking(database);
      const stayId = componentIdFor(seeded, "accommodation");
      const authorizedStay = seeded.terms.components.find(
        (component) => component.componentId === stayId,
      )!;
      const providers = createProviders(
        {
          duffel: { execute: confirmedWith("duffel-flight") },
          trainline: { execute: confirmedWith("trainline-rail") },
          booking: {
            execute: () => {
              throw new Error("timeout after commit");
            },
            status: () => ({
              status: "confirmed",
              providerReference: "booking-stay",
              evidenceId: "booking-evidence",
              confirmedTerms: {
                ...authorizedStay,
                finalCustomerMinor: authorizedStay.finalCustomerMinor + 500,
              },
            }),
          },
        },
        calls,
      );
      const activities = createBookingActivities(database, providers);

      await runSaga(database, providers, seeded.transaction!.id);
      const reconciled = await activities.reconcileProviderStatus(seeded.transaction!.id, stayId);

      expect(reconciled.status).toBe("action_required");
      expect(calls[`execute:${stayId}`]).toBe(1);
      const transaction = await readTransaction(database, seeded.transaction!.id);
      expect(transaction.executionStatus).toBe("invalidated");
      expect(
        await database
          .selectFrom("bookingConfirmations")
          .select("componentId")
          .where("transactionId", "=", seeded.transaction!.id)
          .where("componentId", "=", stayId)
          .execute(),
      ).toEqual([{ componentId: stayId }]);
    });
  }, 120_000);

  it("revalidates a single rescheduled component and preserves unrelated confirmations", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const calls: Record<string, number> = {};
      const seeded = await seedAuthorizedBooking(database);
      const railId = componentIdFor(seeded, "rail");
      const authorizedRail = seeded.terms.components.find(
        (component) => component.componentId === railId,
      )!;
      const providers = createProviders(
        {
          duffel: { execute: confirmedWith("duffel-flight") },
          trainline: {
            execute: confirmedWith("trainline-rail"),
            revalidate: () => ({
              outcome: "changed",
              terms: {
                ...authorizedRail,
                serviceStart: "2030-05-03T08:00:00+01:00",
                serviceEnd: "2030-05-03T10:00:00+01:00",
              },
            }),
          },
          booking: { execute: confirmedWith("booking-stay") },
        },
        calls,
      );
      const activities = createBookingActivities(database, providers);

      await runSaga(database, providers, seeded.transaction!.id);
      const currentVersion = (
        await database
          .selectFrom("trips")
          .select("currentVersion")
          .where("id", "=", seeded.tripId)
          .executeTakeFirstOrThrow()
      ).currentVersion;
      const request = await startComponentRescheduleRevalidation(
        database,
        seeded.userId,
        seeded.transaction!.id,
        railId,
        { requestId: randomUUID(), requestedChange: { serviceStart: "2030-05-03T08:00:00+01:00" } },
      );
      const revalidated = await activities.revalidateComponentReschedule({
        workflowId: request.workflowId,
        tripId: seeded.tripId,
        ownerUserId: seeded.userId,
        tripVersion: currentVersion,
        bookingId: seeded.transaction!.id,
        componentId: railId,
        requestedChange: { serviceStart: "2030-05-03T08:00:00+01:00" },
      });

      expect(revalidated.status).toBe("completed");
      expect(revalidated.outcomes).toEqual([{ componentId: railId, outcome: "changed" }]);
      expect(revalidated.terms?.components.map((component) => component.componentId)).toEqual([
        railId,
      ]);
      expect(calls[`execute:${railId}`]).toBe(1);
      // Unrelated confirmations are untouched by an isolated component revalidation.
      expect(
        (
          await database
            .selectFrom("bookingConfirmations")
            .select("componentId")
            .where("transactionId", "=", seeded.transaction!.id)
            .execute()
        )
          .map((entry) => entry.componentId)
          .sort(),
      ).toEqual(
        [componentIdFor(seeded, "flight"), componentIdFor(seeded, "accommodation"), railId].sort(),
      );
    });
  }, 120_000);
});
