import { createHash, randomUUID } from "node:crypto";

import { sql, type Kysely } from "kysely";

import {
  bookingTermsSchema,
  bookingTermsV2Schema,
  hashBookingTerms,
  type BookingTerms,
} from "../../domain/booking/authorization";
import { bookingTransactionSchema } from "../../domain/booking/schema";
import { commitTripMutation } from "../../domain/trip/commit";
import { createTrip } from "../../domain/trip/create";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";
import { tripSnapshotSchema, type TripSnapshot } from "../../domain/trip/schema";
import { BookingRepository } from "../../server/db/booking-repository";
import { inTransaction } from "../../server/db/transaction";
import { createSyntheticTripSnapshot } from "../fixtures/trips";
import {
  reviewNow,
  wholeTripReviewFixture,
  wholeTripTermsFixture,
} from "../fixtures/whole-trip-review";

import type { Database } from "../../server/db/database";
import type { BookingTransaction } from "../../domain/booking/schema";
import type { TrustedBookingPrerequisiteReader } from "../../server/supply/payment";

export interface SeededBooking {
  userId: string;
  tripId: string;
  tripVersion: number;
  terms: BookingTerms;
  authorizationId: string;
  transaction: BookingTransaction | null;
  snapshot: TripSnapshot;
}

export interface SeedBookingOptions {
  now?: Date;
  expiresInMs?: number;
  serviceStart?: string;
  serviceEnd?: string;
  startTransaction?: boolean;
}

// Historical v1 fixture for legacy execution/reconciliation tests. New starts
// must use a complete v2 review instead of this saved authorization.
export async function seedAuthorizedBooking(
  database: Kysely<Database>,
  options: SeedBookingOptions = {},
): Promise<SeededBooking> {
  const now = options.now ?? new Date();
  const userId = randomUUID();
  await sql`INSERT INTO app."user" (id, name, email) VALUES (${userId}, 'Synthetic booking owner', ${`booking-${userId}@example.invalid`})`.execute(
    database,
  );
  const checkedAt = "2029-11-01T12:00:00Z";
  const serviceStart = options.serviceStart ?? "2030-05-02T08:00:00+01:00";
  const serviceEnd = options.serviceEnd ?? "2030-05-02T10:00:00+01:00";
  const travellerId = randomUUID();
  const planned = [
    {
      type: "flight" as const,
      finalMinor: 60_000,
      taxesMinor: 6_000,
      details: { legs: ["Synthetic outbound flight"], baggage: [] },
    },
    {
      type: "rail" as const,
      finalMinor: 5_000,
      taxesMinor: 500,
      details: {
        originStation: "Synthetic station A",
        destinationStation: "Synthetic station B",
        route: "Synthetic route",
      },
    },
    {
      type: "accommodation" as const,
      finalMinor: 20_000,
      taxesMinor: 2_000,
      details: { occupancy: "Synthetic lodging for two travellers", amenities: [] },
    },
  ];
  const components = planned.map((entry) => ({
    id: randomUUID(),
    itineraryItemIds: [],
    provider: entry.type === "flight" ? "duffel" : entry.type === "rail" ? "trainline" : "booking",
    supplierOfferId: `synthetic-offer-${entry.type}`,
    type: entry.type,
    offerStatus: "available",
    serviceStart,
    serviceEnd,
    travellerIds: [travellerId],
    bookingRequirements: ["Traveller identities must be verified before booking"],
    cancellationTerms: "Synthetic refundable terms",
    checkedAt,
    expiresAt: null,
    bookingStatus: "unbooked",
    details: entry.details,
    price: {
      supplierAmount: { currency: "GBP", minorUnits: entry.finalMinor - entry.taxesMinor },
      platformMargin: { currency: "GBP", minorUnits: 0 },
      customerPayableTaxes: { currency: "GBP", minorUnits: entry.taxesMinor },
      customerPayableFees: { currency: "GBP", minorUnits: 0 },
      finalCustomerAmount: { currency: "GBP", minorUnits: entry.finalMinor },
      status: "estimated",
      source: "synthetic",
      checkedAt,
      expiresAt: null,
    },
  }));
  const money = (minorUnits: number) => ({ currency: "GBP", minorUnits });
  const sum = (
    field:
      "supplierAmount" | "customerPayableTaxes" | "customerPayableFees" | "finalCustomerAmount",
  ) => components.reduce((total, component) => total + component.price[field].minorUnits, 0);
  const snapshot = tripSnapshotSchema.parse({
    ...createSyntheticTripSnapshot(),
    components,
    price: {
      currency: "GBP",
      supplierTotal: money(sum("supplierAmount")),
      platformMarginTotal: money(0),
      customerPayableTaxesTotal: money(sum("customerPayableTaxes")),
      customerPayableFeesTotal: money(sum("customerPayableFees")),
      finalCustomerTotal: money(sum("finalCustomerAmount")),
      status: "estimated",
      checkedAt,
      conversionDisclosures: [],
    },
  });
  const creationSnapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
  creationSnapshot.itineraryDays = [];
  const trip = await createTrip(database, userId, {
    requestId: randomUUID(),
    title: "Synthetic booking trip",
    currency: "GBP",
    snapshot: creationSnapshot,
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
    changeSummary: ["finalization", "feasibility_policy_v1"],
    inverseOperation: { operation: "replace", target: "/", value: trip.snapshot },
    nonReversibleReason: null,
    outboxEventId: randomUUID(),
    auditEventId: randomUUID(),
  });
  const expiresAt = new Date(now.getTime() + (options.expiresInMs ?? 300_000)).toISOString();
  const authorizedAt = new Date(
    Math.min(Date.parse(expiresAt) - 1_000, now.getTime() - 1_000),
  ).toISOString();
  const terms = bookingTermsSchema.parse({
    departureOrigin: {
      kind: snapshot.departureOrigin!.kind,
      placeId: snapshot.departureOrigin!.placeId,
      name: snapshot.departureOrigin!.name,
      countryCode: snapshot.departureOrigin!.countryCode,
      timezone: snapshot.departureOrigin!.timezone,
      airportCode: snapshot.departureOrigin!.airportCode,
    },
    travellerParty: snapshot.travellerParty,
    components: snapshot.components.map((component) => ({
      componentId: component.id,
      supplierOfferId: component.supplierOfferId,
      inventoryId: `${component.id}-inventory`,
      serviceStart: component.serviceStart,
      serviceEnd: component.serviceEnd,
      travellerIds: component.travellerIds,
      finalCustomerMinor: component.price.finalCustomerAmount.minorUnits,
      taxesMinor: component.price.customerPayableTaxes!.minorUnits,
      feesMinor: component.price.customerPayableFees!.minorUnits,
      currency: component.price.finalCustomerAmount.currency,
      cancellationTerms: component.cancellationTerms,
      expiresAt,
      nonReversible: false,
    })),
    totalPrice: {
      currency: "GBP",
      minorUnits: components.reduce(
        (total, component) => total + component.price.finalCustomerAmount.minorUnits,
        0,
      ),
    },
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
      authorizedAt,
      expiresAt,
    }),
  );
  const transaction =
    options.startTransaction === false
      ? null
      : await inTransaction(database, async (connection) => {
          const id = randomUUID();
          const historical = bookingTransactionSchema.parse({
            id,
            tripId: trip.tripId,
            authorizationId,
            operation: "book_trip",
            status: "requested",
            components: terms.components.map((entry) => ({
              componentId: entry.componentId,
              status: "authorized",
              providerReference: null,
              safeReason: null,
            })),
            startedAt: now.toISOString(),
            completedAt: null,
            executionBasis: {
              ownerUserId: userId,
              operation: "book_trip",
              authorizationId,
              startingTripVersion: finalized.version,
              terms,
              termsHash: hashBookingTerms(terms),
              expiresAt,
            },
            lastObservedTripVersion: finalized.version,
            executionStatus: "active",
            workflowId: `historical-booking-${id}`,
            requestId: randomUUID(),
          });
          if (
            !(await new BookingRepository(connection).startTransaction({
              transaction: historical,
              ownerUserId: userId,
            }))
          )
            throw new Error("Historical booking fixture could not be persisted");
          return historical;
        });
  return {
    userId,
    tripId: trip.tripId,
    tripVersion: finalized.version,
    terms,
    authorizationId,
    transaction,
    snapshot,
  };
}

export async function seedReviewedWholeTrip(
  database: Kysely<Database>,
  mutateSnapshot?: (snapshot: TripSnapshot) => void,
  status: "accepted" | "completed" = "completed",
  ownerUserId?: string,
  now = reviewNow,
  acceptedEstimateReductionMinor = 0,
) {
  const fixture = wholeTripReviewFixture();
  const checkedAt = now.toISOString(),
    expiresAt = new Date(now.getTime() + 300_000).toISOString();
  for (const evidence of fixture.evidence) {
    evidence.checkedAt = checkedAt;
    evidence.expiresAt = expiresAt;
  }
  for (const component of fixture.snapshot.components) {
    component.checkedAt = checkedAt;
    component.expiresAt = expiresAt;
    component.price.checkedAt = checkedAt;
    component.price.expiresAt = expiresAt;
    if (component.planningDetails) component.planningDetails.checkedAt = checkedAt;
  }
  fixture.snapshot.components[0].price.supplierAmount!.minorUnits -= acceptedEstimateReductionMinor;
  fixture.snapshot.components[0].price.finalCustomerAmount.minorUnits -=
    acceptedEstimateReductionMinor;
  fixture.snapshot.price.supplierTotal!.minorUnits -= acceptedEstimateReductionMinor;
  fixture.snapshot.price.finalCustomerTotal.minorUnits -= acceptedEstimateReductionMinor;
  const terms = bookingTermsV2Schema.parse(wholeTripTermsFixture(fixture, now));
  const snapshot = structuredClone(fixture.snapshot);
  mutateSnapshot?.(snapshot);
  const userId = ownerUserId ?? randomUUID();
  if (!ownerUserId)
    await sql`INSERT INTO app."user" (id, name, email) VALUES (${userId}, 'Recorded review owner', ${`review-${userId}@example.invalid`})`.execute(
      database,
    );
  const creationSnapshot = projectCustomerSnapshot(createSyntheticTripSnapshot());
  creationSnapshot.itineraryDays = [];
  const trip = await createTrip(database, userId, {
    requestId: randomUUID(),
    title: "Recorded whole-trip review",
    currency: "GBP",
    snapshot: creationSnapshot,
  });
  const requestId = randomUUID();
  await commitTripMutation(database, {
    tripId: trip.tripId,
    ownerUserId: userId,
    expectedVersion: 1,
    lifecycleState: "finalized",
    requestId,
    idempotencyKey: `recorded-review:${requestId}`,
    requestFingerprint: createHash("sha256").update(requestId).digest("hex"),
    snapshot,
    initiatingActor: "user",
    proposalId: null,
    changeSummary: ["finalization", "feasibility_policy_v1"],
    inverseOperation: { operation: "replace", target: "/", value: trip.snapshot },
    nonReversibleReason: null,
    outboxEventId: randomUUID(),
    auditEventId: randomUUID(),
  });
  const workflowId = randomUUID();
  await database
    .insertInto("bookingRevalidations")
    .values({
      workflowId,
      tripId: trip.tripId,
      ownerUserId: userId,
      requestId: randomUUID(),
      requestFingerprint: "a".repeat(64),
      tripVersion: 2,
      status,
      outcomes: sql<unknown[]>`${JSON.stringify([])}::jsonb`,
      terms: status === "completed" ? terms : null,
      termsHash: status === "completed" ? hashBookingTerms(terms) : null,
      coverage: status === "completed" ? terms.coverage : null,
      expiresAt: status === "completed" ? new Date(expiresAt) : null,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  const prerequisites: TrustedBookingPrerequisiteReader = {
    read: async ({ componentId }) => {
      const evidence = fixture.evidence.find((entry) => entry.componentId === componentId);
      return {
        travellers: evidence?.travellerReadiness ?? null,
        payment: evidence?.paymentReadiness ?? null,
      };
    },
  };
  return {
    userId,
    tripId: trip.tripId,
    tripVersion: 2,
    terms,
    snapshot,
    workflowId,
    prerequisites,
    request: {
      requestId: randomUUID(),
      tripVersion: 2,
      termsHash: hashBookingTerms(terms),
      operation: "book_trip" as const,
      componentId: null,
      acknowledgedNonReversibleActions: [],
    },
  };
}
