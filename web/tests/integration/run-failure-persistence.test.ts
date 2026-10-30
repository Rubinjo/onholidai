// @vitest-environment node
import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { createTrip } from "../../domain/trip/create";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import {
  failureCategory,
  RunRepository,
  type FailureCategory,
} from "../../server/agent-client/run-repository";
import { publicRun } from "../../server/agent-client/results";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";

vi.mock("server-only", () => ({}));
if (process.env.CI && !hasIsolatedDatabaseConfiguration())
  throw new Error("Failed-run persistence requires database test credentials");

// Every safe error code the agent can send must survive the agent_runs check constraint.
const failures: readonly { code: string | null; category: FailureCategory }[] = [
  { code: "estimate_deadline", category: "deadline" },
  { code: "source_unavailable", category: "source_unavailable" },
  { code: "invalid_result", category: "invalid_result" },
  { code: "estimate_unavailable", category: "agent_error" },
  { code: "unknown_failure", category: "agent_error" },
  { code: null, category: "agent_error" },
];

function draftSnapshot() {
  const snapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
  snapshot.itineraryDays = [];
  return snapshot;
}

describe.skipIf(!hasIsolatedDatabaseConfiguration())("failed run persistence", () => {
  it("stores every failure category the agent can report", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const userId = randomUUID();
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic','failure@example.invalid')`.execute(
        database,
      );
      const trip = await createTrip(database, userId, {
        requestId: randomUUID(),
        title: "Failure persistence",
        currency: "GBP",
        snapshot: draftSnapshot(),
      });
      const runs = new RunRepository(database);
      for (const failure of failures) {
        const context = {
          userId,
          tripId: trip.tripId,
          requestId: randomUUID(),
          baseTripVersion: 1,
        };
        const reserved = await runs.reserve({
          ...context,
          purpose: "initial_estimate",
          message: `Estimate that fails with ${failure.code ?? "no code"}`,
        });
        const event = {
          version: "1" as const,
          runId: reserved.id,
          cursor: 1,
          occurredAt: new Date().toISOString(),
          type: "failed" as const,
          status: "failed" as const,
          safeErrorCode: failure.code,
        };
        await runs.event(context, reserved.id, 1, { version: "1", ...context, event });
        expect(failureCategory(event)).toBe(failure.category);
        // A rejected persistence here leaves the run open until its lease expires.
        await runs.result(context, reserved.id, {
          version: "1",
          ...context,
          eventCursor: 1,
          status: "failed",
          result: null,
        });
        const stored = await database
          .selectFrom("agentRuns")
          .select(["status", "errorCategory", "result", "leaseExpiresAt", "completedAt"])
          .where("id", "=", reserved.id)
          .executeTakeFirstOrThrow();
        expect(stored.status).toBe("failed");
        expect(stored.errorCategory).toBe(failure.category);
        expect(stored.result).toBeNull();
        expect(stored.leaseExpiresAt).toBeNull();
        expect(stored.completedAt).not.toBeNull();
        const publicView = await publicRun(database, userId, reserved.id);
        expect(publicView.failure?.category).toBe(failure.category);
      }
    });
  }, 60_000);

  it("keeps a recorded failure when the lease expires before its result is stored", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const userId = randomUUID();
      await sql`INSERT INTO app."user" (id,name,email) VALUES (${userId},'Synthetic','lease@example.invalid')`.execute(
        database,
      );
      const trip = await createTrip(database, userId, {
        requestId: randomUUID(),
        title: "Lease expiry",
        currency: "GBP",
        snapshot: draftSnapshot(),
      });
      let now = new Date("2030-01-01T00:00:00Z");
      const runs = new RunRepository(database, () => now);
      const context = { userId, tripId: trip.tripId, requestId: randomUUID(), baseTripVersion: 1 };
      const reserved = await runs.reserve({
        ...context,
        purpose: "initial_estimate",
        message: "Estimate whose result is never recorded",
      });
      await runs.event(context, reserved.id, 1, {
        version: "1",
        ...context,
        event: {
          version: "1",
          runId: reserved.id,
          cursor: 1,
          occurredAt: now.toISOString(),
          type: "failed",
          status: "failed",
          safeErrorCode: "source_unavailable",
        },
      });
      now = new Date("2030-01-01T00:01:31Z");
      // Reading through the lease-aware clock is what marks an abandoned run interrupted.
      expect((await runs.read(userId, reserved.id)).status).toBe("failed");
      const interrupted = await publicRun(database, userId, reserved.id);
      expect(interrupted.status).toBe("failed");
      // The traveller keeps the real cause instead of a transport-level interruption.
      expect(interrupted.failure).toMatchObject({ category: "source_unavailable" });
    });
  }, 30_000);
});
