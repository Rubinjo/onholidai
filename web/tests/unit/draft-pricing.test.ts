// @vitest-environment node
import { describe, expect, it } from "vitest";

import { assertEstablishedPricing } from "../../domain/booking/pricing-evidence";
import { isCompletePlanningOffer, materializePlanningOffer } from "../../server/supply/offers";
import { createSyntheticTripSnapshot } from "../fixtures/trips";

import type { TripSnapshot } from "../../domain/trip/schema";

const now = new Date("2026-10-26T00:00:00Z");

function discoveryOffer(overrides: Record<string, unknown> = {}) {
  const snapshot = createSyntheticTripSnapshot();
  const destination = snapshot.destinations[0];
  return {
    component: {
      id: crypto.randomUUID(),
      itineraryItemIds: [],
      provider: "duffel",
      supplierOfferId: "off_live_1",
      type: "flight",
      offerStatus: "available",
      serviceStart: "2026-11-10T12:00:00Z",
      serviceEnd: "2026-11-10T20:00:00Z",
      travellerIds: [crypto.randomUUID()],
      bookingRequirements: ["Verify traveller identities"],
      cancellationTerms:
        "Duffel Flights: cancellation and change terms are not established by this read; " +
        "verify them before any purchase.",
      details: null,
      planningDetails: {
        locationName: destination.name,
        timezone: null,
        airportNames: [],
        airlines: [],
        flightDirection: null,
        durationMinutes: null,
        layovers: [],
        fareConditions: '{"segmentCount":2}',
        accommodationType: null,
        travelFromStayMinutes: null,
        eligibility: "unverified",
        accessibility: "unverified",
        availability: "unverified",
        constraintEvidence: [],
        source: "Duffel Flights",
        checkedAt: "2026-10-26T00:00:00Z",
        unavailableFacts: ["Complete service details"],
      },
      price: {
        currency: "EUR",
        supplierAmount: null,
        platformMargin: null,
        customerPayableTaxes: { currency: "EUR", minorUnits: 19918 },
        customerPayableFees: null,
        finalCustomerAmount: { currency: "EUR", minorUnits: 130574 },
        status: "estimated",
        source: "duffel",
        checkedAt: "2026-10-26T00:00:00Z",
        expiresAt: null,
      },
      checkedAt: "2026-10-26T00:00:00Z",
      expiresAt: null,
      bookingStatus: "unbooked",
      ...overrides,
    },
    supplierReferences: undefined,
    selectionGroup: "flight:whole_query",
    eligibility: { status: "unverified", minimumAge: null, maximumAge: null },
    occupancy: { maximumAdults: null, maximumChildren: null },
    accessibility: "unverified",
    attribution: { provider: "duffel", sourceUrl: null },
    unverifiedFacts: ["terms", "fees", "details"],
  };
}

describe("draft price relaxation", () => {
  it("materializes a live offer without inventing supplier costs", () => {
    const offer = discoveryOffer();
    expect(isCompletePlanningOffer(offer as never)).toBe(true);
    const materialized = materializePlanningOffer(offer);
    expect(materialized.component.price.platformMargin).toBeNull();
    expect(materialized.component.price.customerPayableFees).toBeNull();
    expect(materialized.component.price.supplierAmount).toBeNull();
    expect(materialized.component.price.finalCustomerAmount).toEqual({
      currency: "EUR",
      minorUnits: 130574,
    });
    expect(materialized.component.details).toBeNull();
  });

  it("rejects an offer whose payable total is missing", () => {
    const offer = discoveryOffer({
      price: {
        currency: "EUR",
        supplierAmount: null,
        platformMargin: null,
        customerPayableTaxes: null,
        customerPayableFees: null,
        finalCustomerAmount: null,
        status: "estimated",
        source: "duffel",
        checkedAt: "2026-10-26T00:00:00Z",
        expiresAt: null,
      },
    });
    expect(isCompletePlanningOffer(offer as never)).toBe(false);
  });

  it("blocks booking while a draft component still has unverified pricing", () => {
    const snapshot = createSyntheticTripSnapshot() as TripSnapshot;
    const materialized = materializePlanningOffer(discoveryOffer()).component;
    snapshot.components = [materialized];
    snapshot.price = {
      currency: "EUR",
      supplierTotal: null,
      platformMarginTotal: null,
      customerPayableTaxesTotal: { currency: "EUR", minorUnits: 19918 },
      customerPayableFeesTotal: null,
      finalCustomerTotal: { currency: "EUR", minorUnits: 130574 },
      status: "estimated",
      checkedAt: now.toISOString(),
      conversionDisclosures: [],
    };
    expect(() => assertEstablishedPricing(snapshot)).toThrowError(
      /Booking requires revalidated supplier pricing/,
    );
    snapshot.components = [
      {
        ...materialized,
        type: "flight" as const,
        details: { legs: ["AMS-HND"], baggage: [] },
        price: {
          ...materialized.price,
          supplierAmount: { currency: "EUR", minorUnits: 110656 },
          platformMargin: { currency: "EUR", minorUnits: 0 },
          customerPayableFees: { currency: "EUR", minorUnits: 0 },
        },
      },
    ];
    expect(() => assertEstablishedPricing(snapshot)).not.toThrow();
  });
});
