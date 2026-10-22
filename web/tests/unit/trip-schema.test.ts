import { describe, expect, it } from "vitest";

import {
  decodeTripSnapshot,
  componentPriceSchema,
  moneySchema,
  travelComponentSchema,
  tripSchema,
  tripVersionSchema,
  UnsupportedTripSnapshotVersionError,
} from "../../domain/trip/schema";

const ids = {
  trip: "10000000-0000-4000-8000-000000000001",
  user: "10000000-0000-4000-8000-000000000002",
  request: "10000000-0000-4000-8000-000000000003",
  window: "10000000-0000-4000-8000-000000000004",
  destination: "10000000-0000-4000-8000-000000000005",
};

const timestamp = "2026-10-11T12:00:00Z";
const zero = { currency: "USD", minorUnits: 0 };

function snapshotFixture() {
  return {
    departureOrigin: {
      kind: "city",
      placeId: "place:new-york",
      name: "New York",
      countryCode: "US",
      timezone: "America/New_York",
      airportCode: null,
      confirmedByUser: true,
    },
    availabilityWindows: [
      {
        id: ids.window,
        startDate: "2027-04-01",
        endDate: "2027-04-10",
        preference: "preferred",
        timezone: "America/New_York",
      },
    ],
    duration: { minimumDays: 5, idealDays: 7, maximumDays: 9 },
    travellerParty: { adults: 2, children: [] },
    preferences: { pace: 50, spend: 50, discovery: 50, independence: 50, setting: 50 },
    constraints: [],
    destinations: [
      {
        id: ids.destination,
        kind: "city",
        name: "Lisbon",
        countryCode: "PT",
        providerPlaceIds: {},
        location: { latitude: 38.7223, longitude: -9.1393 },
        routePosition: 0,
        arrivalDate: null,
        departureDate: null,
        plannedNights: 0,
      },
    ],
    itineraryDays: [],
    components: [],
    price: {
      currency: "USD",
      supplierTotal: zero,
      platformMarginTotal: zero,
      customerPayableTaxesTotal: zero,
      customerPayableFeesTotal: zero,
      finalCustomerTotal: zero,
      status: "estimated",
      checkedAt: timestamp,
      conversionDisclosures: [],
    },
    warnings: [],
  };
}

describe("Trip and TripVersion schemas", () => {
  it("accepts only safe integer minor units and recognized ISO currencies", () => {
    expect(
      moneySchema.safeParse({ currency: "GBP", minorUnits: Number.MAX_SAFE_INTEGER }).success,
    ).toBe(true);
    for (const minorUnits of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN]) {
      expect(moneySchema.safeParse({ currency: "GBP", minorUnits }).success).toBe(false);
    }
    for (const currency of ["gbp", "ZZZ", "GBP ", "GB"]) {
      expect(moneySchema.safeParse({ currency, minorUnits: 100 }).success).toBe(false);
    }
  });

  it("keeps component price arithmetic and accepted service dates strict", () => {
    const price = {
      supplierAmount: zero,
      platformMargin: zero,
      customerPayableTaxes: zero,
      customerPayableFees: zero,
      finalCustomerAmount: zero,
      status: "estimated",
      source: "synthetic",
      checkedAt: timestamp,
      expiresAt: null,
    };
    const component = {
      id: ids.request,
      itineraryItemIds: [],
      provider: "synthetic",
      supplierOfferId: "synthetic-stay",
      type: "accommodation",
      offerStatus: "available",
      serviceStart: "2027-04-01T14:00:00Z",
      serviceEnd: "2027-04-02T10:00:00Z",
      travellerIds: [ids.user],
      bookingRequirements: [],
      cancellationTerms: "Synthetic terms",
      price,
      checkedAt: timestamp,
      expiresAt: null,
      bookingStatus: "unbooked",
      details: { occupancy: "One adult", amenities: [] },
    };

    expect(travelComponentSchema.safeParse(component).success).toBe(true);
    expect(travelComponentSchema.safeParse({ ...component, serviceStart: null }).success).toBe(
      false,
    );
    expect(
      travelComponentSchema.safeParse({ ...component, serviceEnd: component.serviceStart }).success,
    ).toBe(false);
    expect(travelComponentSchema.safeParse({ ...component, unexpected: true }).success).toBe(false);
    expect(
      componentPriceSchema.safeParse({
        ...price,
        supplierAmount: { currency: "GBP", minorUnits: 0 },
      }).success,
    ).toBe(false);
    expect(
      componentPriceSchema.safeParse({ ...price, finalCustomerAmount: { ...zero, minorUnits: 1 } })
        .success,
    ).toBe(false);
  });

  it("accepts a complete current snapshot and immutable root metadata", () => {
    const snapshot = snapshotFixture();
    const decoded = decodeTripSnapshot(1, snapshot);
    const trip = tripSchema.parse({
      id: ids.trip,
      ownerUserId: ids.user,
      title: "Spring in Lisbon",
      lifecycleState: "draft",
      currentVersion: 1,
      currency: "USD",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    });

    expect(decoded).toMatchObject({ compatibility: "current", requiresDepartureOrigin: false });
    expect(trip.currentVersion).toBe(1);
  });

  it("reads legacy snapshots without inventing a departure origin", () => {
    const legacy = snapshotFixture();
    Reflect.deleteProperty(legacy, "departureOrigin");

    expect(decodeTripSnapshot({ snapshot: legacy })).toMatchObject({
      schemaVersion: 0,
      compatibility: "legacy",
      requiresDepartureOrigin: true,
    });
  });

  it("rejects unsupported snapshot versions", () => {
    expect(() => decodeTripSnapshot(2, snapshotFixture())).toThrow(
      UnsupportedTripSnapshotVersionError,
    );
  });

  it("enforces version chains, proposal identity, and reversibility evidence", () => {
    const base = {
      tripId: ids.trip,
      version: 2,
      previousVersion: 1,
      schemaVersion: 1,
      snapshot: snapshotFixture(),
      initiatingActor: "agent_proposal",
      initiatingRequestId: ids.request,
      proposalId: null,
      changeSummary: ["destinations"],
      inverseOperation: null,
      nonReversibleReason: null,
      createdAt: timestamp,
    };

    expect(() => tripVersionSchema.parse(base)).toThrow();
    expect(
      tripVersionSchema.safeParse({
        ...base,
        proposalId: "10000000-0000-4000-8000-000000000006",
        nonReversibleReason: "External offer cannot be reconstructed",
      }).success,
    ).toBe(true);
  });
});
