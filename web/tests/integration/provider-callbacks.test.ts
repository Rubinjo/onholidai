// @vitest-environment node
import { createHmac, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "kysely";

import { processProviderCallback, verifyProviderCallback } from "../../server/supply/callbacks";
import { TransactionProviderRegistry } from "../../server/supply/transactions";
import { createBookingActivities } from "../../server/workflows/book-activities";
import { seedAuthorizedBooking } from "../helpers/booking";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

vi.mock("server-only", () => ({}));

describe("provider callback authentication", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only an HMAC signature for the exact provider payload", () => {
    const raw = JSON.stringify({ providerEventId: "evt-1", outcome: "unknown" });
    vi.stubEnv("DUFFEL_CALLBACK_SECRET", "synthetic-callback-secret");
    const signature = `sha256=${createHmac("sha256", "synthetic-callback-secret").update(raw).digest("hex")}`;
    expect(verifyProviderCallback("duffel", raw, signature)).toBe(true);
    expect(verifyProviderCallback("duffel", raw + " ", signature)).toBe(false);
    expect(verifyProviderCallback("booking", raw, signature)).toBe(false);
  });

  const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;
  describeWithDatabase("durable authenticated callback evidence", () => {
    afterEach(() => vi.unstubAllEnvs());

    for (const executionStatus of ["expired", "invalidated"] as const) {
      for (const edited of [false, true]) {
        it(`preserves confirmation, replay and conflicts when ${executionStatus}, edited=${edited}`, async () => {
          vi.stubEnv("DUFFEL_CALLBACK_SECRET", "synthetic-callback-secret");
          await withIsolatedTestDatabase(async ({ database }) => {
            const seeded = await seedAuthorizedBooking(database);
            const flight = seeded.snapshot.components.find((entry) => entry.type === "flight")!;
            const terms = seeded.terms.components.find((entry) => entry.componentId === flight.id)!;
            const providers = new TransactionProviderRegistry();
            providers.register({
              provider: "duffel",
              capabilities: {
                book: true,
                status: false,
                cancel: false,
                reschedule: false,
                idempotency: false,
              },
              execute: async () => ({
                status: "unknown",
                safeReason: "Timeout after possible commit",
              }),
            });
            const activities = createBookingActivities(database, providers);
            const claim = await activities.claimProviderWrite(seeded.transaction!.id, flight.id);
            await activities.executeProviderWrite(
              seeded.transaction!.id,
              flight.id,
              claim.idempotencyKey,
              claim.requestFingerprint,
            );
            if (edited) {
              // Simulate legacy/out-of-band divergence; normal planning blocks in-flight claims.
              const prior = await database
                .selectFrom("tripVersions")
                .selectAll()
                .where("tripId", "=", seeded.tripId)
                .where("version", "=", 3)
                .executeTakeFirstOrThrow();
              await database
                .insertInto("tripVersions")
                .values({
                  ...prior,
                  version: 4,
                  previousVersion: 3,
                  initiatingActor: "user",
                  initiatingRequestId: randomUUID(),
                  changeSummary: sql<string[]>`'["unrelated edit"]'::jsonb`,
                })
                .execute();
              await database
                .updateTable("trips")
                .set({ currentVersion: 4 })
                .where("id", "=", seeded.tripId)
                .execute();
            }
            await database
              .updateTable("bookingTransactions")
              .set({ executionStatus })
              .where("id", "=", seeded.transaction!.id)
              .execute();
            const before = await database
              .selectFrom("trips")
              .select("currentVersion")
              .where("id", "=", seeded.tripId)
              .executeTakeFirstOrThrow();
            const payload = {
              providerEventId: "late-authenticated-event",
              transactionId: seeded.transaction!.id,
              componentId: flight.id,
              outcome: "confirmed",
              providerReference: "late-supplier-flight",
              confirmedTerms: terms,
              safeReason: null,
            };
            const send = (value: typeof payload) => {
              const raw = JSON.stringify(value);
              const signature = `sha256=${createHmac("sha256", "synthetic-callback-secret").update(raw).digest("hex")}`;
              return processProviderCallback(database, "duffel", raw, signature);
            };
            expect(await send(payload)).toEqual({ accepted: true, outcome: "confirmed" });
            expect(await send(payload)).toEqual({ accepted: true, outcome: "confirmed" });
            const confirmations = await database
              .selectFrom("bookingConfirmations")
              .select("providerReference")
              .where("transactionId", "=", seeded.transaction!.id)
              .execute();
            expect(confirmations).toEqual([{ providerReference: "late-supplier-flight" }]);
            if (edited)
              expect(
                await database
                  .selectFrom("trips")
                  .select("currentVersion")
                  .where("id", "=", seeded.tripId)
                  .executeTakeFirstOrThrow(),
              ).toEqual(before);
            await expect(
              send({ ...payload, providerReference: "contradictory-flight" }),
            ).rejects.toMatchObject({
              code: "provider_callback_conflict",
            });
            expect(
              await database
                .selectFrom("bookingConfirmations")
                .select("providerReference")
                .where("transactionId", "=", seeded.transaction!.id)
                .execute(),
            ).toEqual(confirmations);
            const attempt = await database
              .selectFrom("bookingComponentAttempts")
              .select(["evidenceConflict", "providerEvidence"])
              .where("transactionId", "=", seeded.transaction!.id)
              .executeTakeFirstOrThrow();
            expect(attempt.evidenceConflict).toBe(true);
            expect(attempt.providerEvidence).toEqual(
              expect.arrayContaining([
                expect.objectContaining({ providerReference: "contradictory-flight" }),
              ]),
            );
          });
        }, 120_000);
      }
    }
  });

  it("rejects callbacks when provider credentials are not configured", () => {
    vi.stubEnv("DUFFEL_CALLBACK_SECRET", "");
    expect(verifyProviderCallback("duffel", "{}", "sha256=invalid")).toBe(false);
  });

  it("rejects unknown callback fields before opening a database transaction", async () => {
    const raw = JSON.stringify({
      providerEventId: "evt-closed-object",
      transactionId: "10000000-0000-4000-8000-000000000001",
      componentId: "10000000-0000-4000-8000-000000000002",
      outcome: "unknown",
      providerReference: null,
      confirmedTerms: null,
      safeReason: null,
      unexpected: true,
    });
    vi.stubEnv("DUFFEL_CALLBACK_SECRET", "synthetic-callback-secret");
    const signature = `sha256=${createHmac("sha256", "synthetic-callback-secret").update(raw).digest("hex")}`;
    await expect(processProviderCallback({} as never, "duffel", raw, signature)).rejects.toThrow();
  });
});
