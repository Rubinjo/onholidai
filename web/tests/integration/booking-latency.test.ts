// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { describe, expect, it, vi } from "vitest";

import { bookingTermsSchema, hashBookingTerms } from "../../domain/booking/authorization";
import { projectBookingTransactionRow } from "../../domain/booking/schema";
import { startBooking } from "../../domain/booking/start";
import { commitTripMutation } from "../../domain/trip/commit";
import { createTrip } from "../../domain/trip/create";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { tripSnapshotSchema } from "../../domain/trip/schema";
import { BookingRepository } from "../../server/db/booking-repository";
import { inTransaction } from "../../server/db/transaction";
import { hasIsolatedDatabaseConfiguration, withIsolatedTestDatabase } from "../helpers/database";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

import type { Database } from "../../server/db/database";

vi.mock("server-only", () => ({}));

const describeWithDatabase = hasIsolatedDatabaseConfiguration() ? describe : describe.skip;

async function seedLatencyFixture(database: Kysely<Database>) {
  const userId = randomUUID();
  await sql`INSERT INTO app."user" (id, name, email) VALUES (${userId}, 'Synthetic booking owner', ${`latency-${userId}@example.invalid`})`.execute(
    database,
  );
  const checkedAt = "2029-11-01T12:00:00Z";
  const travellerId = randomUUID();
  const components = [
    {
      id: randomUUID(),
      itineraryItemIds: [],
      provider: "synthetic",
      supplierOfferId: "synthetic-offer-flight",
      type: "flight",
      offerStatus: "available",
      serviceStart: "2030-05-02T08:00:00+01:00",
      serviceEnd: "2030-05-02T10:00:00+01:00",
      travellerIds: [travellerId],
      bookingRequirements: ["Traveller identities must be verified before booking"],
      cancellationTerms: "Synthetic refundable terms",
      checkedAt,
      expiresAt: null,
      bookingStatus: "unbooked",
      details: { legs: ["Synthetic outbound flight"], baggage: [] },
      price: {
        supplierAmount: { currency: "GBP", minorUnits: 54_000 },
        platformMargin: { currency: "GBP", minorUnits: 0 },
        customerPayableTaxes: { currency: "GBP", minorUnits: 6_000 },
        customerPayableFees: { currency: "GBP", minorUnits: 0 },
        finalCustomerAmount: { currency: "GBP", minorUnits: 60_000 },
        status: "estimated",
        source: "synthetic",
        checkedAt,
        expiresAt: null,
      },
    },
  ];
  const snapshot = tripSnapshotSchema.parse({
    ...createSyntheticTripSnapshot(),
    components,
    price: {
      currency: "GBP",
      supplierTotal: { currency: "GBP", minorUnits: 54_000 },
      platformMarginTotal: { currency: "GBP", minorUnits: 0 },
      customerPayableTaxesTotal: { currency: "GBP", minorUnits: 6_000 },
      customerPayableFeesTotal: { currency: "GBP", minorUnits: 0 },
      finalCustomerTotal: { currency: "GBP", minorUnits: 60_000 },
      status: "estimated",
      checkedAt,
      conversionDisclosures: [],
    },
  });
  const creation = projectCustomerSnapshot(createSyntheticTripSnapshot());
  creation.itineraryDays = [];
  const trip = await createTrip(database, userId, {
    requestId: randomUUID(),
    title: "Synthetic latency trip",
    currency: "GBP",
    snapshot: creation,
  });
  const finalized = await commitTripMutation(database, {
    tripId: trip.tripId,
    ownerUserId: userId,
    expectedVersion: 1,
    lifecycleState: "finalized",
    requestId: randomUUID(),
    idempotencyKey: `finalize:${trip.tripId}`,
    requestFingerprint: createHash("sha256").update(`finalize:${trip.tripId}`).digest("hex"),
    snapshot,
    initiatingActor: "user",
    proposalId: null,
    changeSummary: ["finalization"],
    inverseOperation: { operation: "replace", target: "/", value: trip.snapshot },
    nonReversibleReason: null,
    outboxEventId: randomUUID(),
    auditEventId: randomUUID(),
  });
  const expiresAt = new Date(Date.now() + 600_000).toISOString();
  const terms = bookingTermsSchema.parse({
    departureOrigin: {
      kind: "airport",
      placeId: "synthetic-place-gb-lhr",
      name: "Synthetic London Airport",
      countryCode: "GB",
      timezone: "Europe/London",
      airportCode: "LHR",
    },
    travellerParty: snapshot.travellerParty,
    components: components.map((component) => ({
      componentId: component.id,
      supplierOfferId: component.supplierOfferId,
      inventoryId: `${component.id}-inventory`,
      serviceStart: component.serviceStart,
      serviceEnd: component.serviceEnd,
      travellerIds: component.travellerIds,
      finalCustomerMinor: 60_000,
      taxesMinor: 6_000,
      feesMinor: 0,
      currency: "GBP",
      cancellationTerms: component.cancellationTerms,
      expiresAt,
      nonReversible: false,
    })),
    totalPrice: { currency: "GBP", minorUnits: 60_000 },
    nonReversibleActions: [],
  });
  const authorizationId = randomUUID();
  await inTransaction(database, (transaction) =>
    new BookingRepository(transaction).insertAuthorization({
      id: authorizationId,
      tripId: trip.tripId,
      userId,
      tripVersion: finalized.version,
      operation: "book_trip",
      componentId: null,
      terms,
      termsHash: hashBookingTerms(terms),
      acknowledgedNonReversibleActions: [],
      status: "authorized",
      reason: null,
      authorizedAt: new Date().toISOString(),
      expiresAt,
    }),
  );
  return { userId, tripId: trip.tripId, authorizationId };
}

describeWithDatabase("booking acknowledgement and status latency", () => {
  it("acknowledges a durable booking request within 500 ms and reads first status within 5 seconds", async () => {
    await withIsolatedTestDatabase(async ({ database }) => {
      const samples = 8;
      const acknowledgements: number[] = [],
        statusReads: number[] = [];

      for (let index = 0; index < samples; index += 1) {
        // Each acknowledgement is a fresh authorized request so the measured path
        // includes the durable transaction, claim and outbox writes.
        const fixture = await seedLatencyFixture(database);
        const started = performance.now();
        const booking = await startBooking(database, fixture.userId, fixture.tripId, {
          requestId: randomUUID(),
          authorizationId: fixture.authorizationId,
        });
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
