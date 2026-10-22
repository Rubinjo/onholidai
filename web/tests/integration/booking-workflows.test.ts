// @vitest-environment node
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";
import { NativeConnection, Worker } from "@temporalio/worker";

import { commitTripMutation } from "../../domain/trip/commit";
import { startComponentRescheduleRevalidation } from "../../domain/booking/reschedule";
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
import { seedAuthorizedBooking, type SeededBooking } from "../helpers/booking";

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

describeWithDatabase("booking workflow durability", () => {
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
      ).toEqual([]);
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
