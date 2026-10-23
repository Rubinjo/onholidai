// @vitest-environment node
import { randomUUID } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { authorizeBooking } from "../../domain/booking/authorize";
import { projectBookingTransactionRow } from "../../domain/booking/schema";
import { startBooking } from "../../domain/booking/start";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
import { seedReviewedWholeTrip } from "../helpers/booking";

vi.mock("server-only", () => ({}));

const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;

describeWithDatabase("booking acknowledgement and status latency", () => {
  it("acknowledges a durable booking request within 500 ms and reads first status within 5 seconds", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const samples = 8;
      const acknowledgements: number[] = [],
        statusReads: number[] = [];

      for (let index = 0; index < samples; index += 1) {
        // Each acknowledgement is a fresh authorized request so the measured path
        // includes the durable transaction, claim and outbox writes.
        const now = new Date();
        const fixture = await seedReviewedWholeTrip(database, undefined, undefined, undefined, now);
        const authorization = await authorizeBooking(
          database,
          fixture.userId,
          fixture.tripId,
          fixture.request,
          now,
          fixture.prerequisites,
        );
        const started = performance.now();
        const booking = await startBooking(
          database,
          fixture.userId,
          fixture.tripId,
          {
            requestId: randomUUID(),
            authorizationId: authorization.id,
          },
          { prerequisites: fixture.prerequisites },
        );
        acknowledgements.push(performance.now() - started);

        // Mirrors the durable read performed by the booking status route.
        const statusStarted = performance.now();
        const record = await database
          .selectFrom("bookingTransactions")
          .selectAll()
          .where("id", "=", booking.id)
          .where("ownerUserId", "=", fixture.userId)
          .executeTakeFirstOrThrow();
        projectBookingTransactionRow(record);
        statusReads.push(performance.now() - statusStarted);
      }

      const max = (values: number[]) => Math.max(...values);
      expect(acknowledgements).toHaveLength(samples);
      expect(max(acknowledgements)).toBeLessThanOrEqual(500);
      expect(max(statusReads)).toBeLessThanOrEqual(5_000);
    });
  }, 120_000);
});
