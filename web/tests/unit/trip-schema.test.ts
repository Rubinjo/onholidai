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
    expect(moneySchema.safeParse({ currency: "EUR", minorUnits: 100 }).success).toBe(true);
    for (const currency of ["gbp", "ZZZ", "XYZ", "GBP ", "GB"]) {
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

  it("keeps a round-trip fare's flown journeys optional but internally ordered", () => {
    const component = {
      id: ids.request,
      itineraryItemIds: [],
      provider: "duffel",
      supplierOfferId: "off_journeys",
      type: "flight",
      offerStatus: "available",
      serviceStart: "2026-10-31T23:00:00Z",
      serviceEnd: "2026-11-07T08:30:00Z",
      travellerIds: [ids.user],
      bookingRequirements: [],
      cancellationTerms: "Synthetic terms",
      price: {
        supplierAmount: zero,
        platformMargin: zero,
        customerPayableTaxes: zero,
        customerPayableFees: zero,
        finalCustomerAmount: zero,
        status: "estimated",
        source: "duffel",
        checkedAt: timestamp,
        expiresAt: null,
      },
      checkedAt: timestamp,
      expiresAt: null,
      bookingStatus: "unbooked",
      details: null,
      planningDetails: {
        locationName: null,
        timezone: null,
        airportNames: ["LHR", "HND"],
        airlines: [],
        flightDirection: "return",
        durationMinutes: null,
        layovers: [],
        fareConditions: null,
        accommodationType: null,
        travelFromStayMinutes: null,
        eligibility: "unverified",
        accessibility: "unverified",
        availability: "unverified",
        constraintEvidence: [],
        source: "duffel",
        checkedAt: timestamp,
        unavailableFacts: [],
      },
    };
    const outbound = {
      direction: "outbound",
      origin: "LHR",
      destination: "HND",
      originTimezone: "Europe/London",
      destinationTimezone: "Asia/Tokyo",
      departingAt: "2026-10-31T23:00:00Z",
      arrivingAt: "2026-11-01T08:30:00Z",
      legs: ["LHR → HND"],
    };
    // Journeys stay additive: a snapshot accepted before them remains readable.
    expect(travelComponentSchema.safeParse(component).success).toBe(true);
    expect(
      travelComponentSchema.safeParse({
        ...component,
        planningDetails: { ...component.planningDetails, flightJourneys: [outbound] },
      }).success,
    ).toBe(true);
    expect(
      travelComponentSchema.safeParse({
        ...component,
        planningDetails: {
          ...component.planningDetails,
          flightJourneys: [{ ...outbound, arrivingAt: outbound.departingAt }],
        },
      }).success,
    ).toBe(false);
    expect(
      travelComponentSchema.safeParse({
        ...component,
        planningDetails: {
          ...component.planningDetails,
          flightJourneys: [{ ...outbound, departingAt: "2026-10-31T23:00:00+01:00" }],
        },
      }).success,
    ).toBe(false);
  });

  it("keeps an unverified price breakdown explicit while the payable total stays authoritative", () => {
    const total = { currency: "USD", minorUnits: 12000 };
    const price = {
      finalCustomerAmount: total,
      status: "estimated",
      source: "duffel",
      checkedAt: timestamp,
      expiresAt: null,
    };
    const partialBreakdown = {
      supplierAmount: { currency: "USD", minorUnits: 9000 },
      platformMargin: { currency: "USD", minorUnits: 0 },
      customerPayableTaxes: { currency: "USD", minorUnits: 1000 },
      customerPayableFees: null,
    };
    const cases = [
      {
        name: "unknown breakdown",
        breakdown: {
          supplierAmount: null,
          platformMargin: null,
          customerPayableTaxes: null,
          customerPayableFees: null,
        },
        valid: true,
      },
      { name: "partial breakdown", breakdown: partialBreakdown, valid: true },
      {
        name: "complete breakdown with mismatched total",
        breakdown: {
          ...partialBreakdown,
          customerPayableFees: { currency: "USD", minorUnits: 0 },
        },
        valid: false,
      },
      {
        name: "partial breakdown with mismatched currency",
        breakdown: {
          ...partialBreakdown,
          supplierAmount: { currency: "GBP", minorUnits: 9000 },
          platformMargin: null,
          customerPayableTaxes: null,
        },
        valid: false,
      },
    ];
    for (const { name, breakdown, valid } of cases) {
      expect(componentPriceSchema.safeParse({ ...price, ...breakdown }).success, name).toBe(valid);
    }
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
