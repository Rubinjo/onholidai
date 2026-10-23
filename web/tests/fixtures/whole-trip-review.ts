import { randomUUID } from "node:crypto";

import { planningDetailsSchema } from "../../domain/trip/itinerary";
import { deriveBookingCoverage } from "../../domain/trip/booking-coverage";
import { tripSnapshotSchema } from "../../domain/trip/schema";
import { createSyntheticTripSnapshot } from "./trips";
import {
  bookingTermsV2Schema,
  hashBookingTerms,
  projectBookingTerms,
} from "../../domain/booking/authorization";
import {
  bookingReviewStateSchema,
  publicBookingTransactionSchema,
} from "../../domain/booking/public";
import { projectCustomerSnapshot } from "../../domain/pricing/projections";

import type { BookingCoverageEvidence } from "../../domain/trip/booking-coverage";

export const reviewNow = new Date("2029-11-01T12:00:00Z");

export function wholeTripReviewFixture() {
  const snapshot = createSyntheticTripSnapshot();
  snapshot.constraints = [];
  snapshot.duration = { minimumDays: 2, idealDays: 2, maximumDays: 2 };
  snapshot.availabilityWindows[0].startDate = "2030-01-02";
  snapshot.availabilityWindows[0].endDate = "2030-01-03";
  const destination = snapshot.destinations[0];
  Object.assign(destination, {
    arrivalDate: "2030-01-02",
    departureDate: "2030-01-03",
    plannedNights: 1,
    timezone: "Europe/Lisbon",
  });
  const travellerIds = [randomUUID(), randomUUID()];
  const checkedAt = reviewNow.toISOString();
  const expiresAt = new Date(reviewNow.getTime() + 300_000).toISOString();
  const origin = {
    placeId: snapshot.departureOrigin!.placeId,
    name: snapshot.departureOrigin!.name,
    timezone: "Europe/London",
    location: { latitude: 51.47, longitude: -0.4543 },
  };
  const city = {
    placeId: destination.id,
    name: destination.name,
    timezone: "Europe/Lisbon",
    location: destination.location,
  };
  const item = (
    type: "meal" | "free_time" | "activity",
    date: string,
    start: string,
    end: string,
  ) => ({
    id: randomUUID(),
    type,
    start: `${date}T${start}`,
    end: `${date}T${end}`,
    location: city.location,
    componentId: null,
    constraintChecks: [],
    status: "planned" as const,
    travelSegment: null,
    verificationStatus: "verified" as const,
    feasibilityPolicyVersion: "1" as const,
    timingEvidence: ["Recorded deterministic schedule"],
  });
  const component = (
    type: "flight" | "accommodation" | "activity",
    start: string,
    end: string,
    minorUnits: number,
    direction: "outbound" | "return" | null = null,
  ) => {
    const provider = { flight: "duffel", accommodation: "nuitee", activity: "viator" }[type];
    const itineraryItemIds: string[] = [];
    return {
      id: randomUUID(),
      type,
      provider,
      supplierOfferId: `recorded-${randomUUID()}`,
      itineraryItemIds,
      offerStatus: "available",
      serviceStart: start,
      serviceEnd: end,
      travellerIds,
      bookingRequirements: [],
      cancellationTerms: "Recorded refundable customer terms",
      checkedAt,
      expiresAt,
      bookingStatus: "unbooked",
      planningDetails: planningDetailsSchema.parse({
        locationName: destination.name,
        timezone: "Europe/Lisbon",
        airportNames: [],
        airlines: [],
        flightDirection: direction,
        durationMinutes: null,
        layovers: [],
        fareConditions: "Recorded fare",
        accommodationType: type === "accommodation" ? "hotel" : null,
        travelFromStayMinutes: 0,
        eligibility: "verified",
        accessibility: "verified",
        availability: "verified",
        constraintEvidence: [],
        source: provider,
        checkedAt,
        unavailableFacts: [],
      }),
      details:
        type === "flight"
          ? { legs: ["Recorded flight"], baggage: ["One cabin bag"] }
          : type === "accommodation"
            ? { occupancy: "Two adults in one room", amenities: [] }
            : { durationMinutes: 60, directions: "Recorded meeting point" },
      price: {
        supplierAmount: { currency: "GBP", minorUnits },
        platformMargin: { currency: "GBP", minorUnits: 0 },
        customerPayableTaxes: { currency: "GBP", minorUnits: 0 },
        customerPayableFees: { currency: "GBP", minorUnits: 0 },
        finalCustomerAmount: { currency: "GBP", minorUnits },
        status: "quoted",
        source: provider,
        checkedAt,
        expiresAt,
      },
    };
  };
  const outbound = component(
    "flight",
    "2030-01-02T10:00:00Z",
    "2030-01-02T12:00:00Z",
    10000,
    "outbound",
  );
  const inbound = component(
    "flight",
    "2030-01-03T16:00:00Z",
    "2030-01-03T18:00:00Z",
    10000,
    "return",
  );
  const stay = component("accommodation", "2030-01-02T14:00:00Z", "2030-01-03T11:00:00Z", 15000);
  const activity = component("activity", "2030-01-02T15:15:00Z", "2030-01-02T16:15:00Z", 5000);
  const travel = (entry: typeof outbound, returning: boolean) => {
    const start = returning ? "2030-01-03T13:00" : "2030-01-02T07:00";
    const value = {
      ...item("activity", start.slice(0, 10), start.slice(11), entry.serviceEnd.slice(11, 16)),
      type: "travel",
      start,
      componentId: entry.id,
      travelSegment: {
        mode: "flight",
        origin: returning ? city : origin,
        destination: returning ? origin : city,
        plannedDeparture: entry.serviceStart,
        plannedArrival: entry.serviceEnd,
        durationMinutes: 120,
        durationUpperBoundMinutes: 120,
        routeGeometry: null,
        directionsSummary: "Recorded direct route",
        source: "recorded-fixture",
        freshnessAt: checkedAt,
        timingEvidence: ["Recorded direct flight"],
        verificationStatus: "verified",
        feasibilityPolicyVersion: "1",
        international: true,
      },
      transitionFromPrevious: {
        durationMinutes: 0,
        durationUpperBoundMinutes: 0,
        source: "recorded-fixture",
        checkedAt,
        verificationStatus: "verified",
      },
    };
    entry.itineraryItemIds = [value.id];
    return value;
  };
  const visit = { ...item("activity", "2030-01-02", "15:15", "16:15"), componentId: activity.id };
  activity.itineraryItemIds = [visit.id];
  const lunch = item("meal", "2030-01-02", "13:00", "13:45");
  snapshot.itineraryDays = tripSnapshotSchema.shape.itineraryDays.parse([
    {
      date: "2030-01-02",
      destinationId: destination.id,
      timezone: "Europe/Lisbon",
      paceAssessment: 50,
      items: [
        travel(outbound, false),
        lunch,
        item("free_time", "2030-01-02", "14:00", "15:00"),
        visit,
        item("meal", "2030-01-02", "17:00", "17:45"),
      ],
    },
    {
      date: "2030-01-03",
      destinationId: destination.id,
      timezone: "Europe/Lisbon",
      paceAssessment: 50,
      items: [
        item("meal", "2030-01-03", "08:00", "08:45"),
        item("free_time", "2030-01-03", "09:00", "10:00"),
        item("meal", "2030-01-03", "12:00", "12:45"),
        travel(inbound, true),
      ],
    },
  ]);
  snapshot.components = tripSnapshotSchema.shape.components.parse([
    outbound,
    inbound,
    stay,
    activity,
  ]);
  for (const field of ["supplierTotal", "finalCustomerTotal"] as const)
    snapshot.price[field].minorUnits = 40000;
  snapshot.price.checkedAt = checkedAt;
  const requirementIds = [
    ["transport:outbound"],
    ["transport:return"],
    [`accommodation:${destination.id}:2030-01-02`],
    [`activity:${visit.id}`],
  ];
  const evidence: BookingCoverageEvidence[] = snapshot.components.map((entry, index) => ({
    componentId: entry.id,
    provider: entry.provider,
    supplierOfferId: entry.supplierOfferId,
    inventoryId: `recorded-inventory-${entry.id}`,
    serviceStart: entry.serviceStart,
    serviceEnd: entry.serviceEnd,
    travellerIds: [...travellerIds],
    requirementIds: requirementIds[index],
    destinationId: destination.id,
    finalCustomerMinor: entry.price.finalCustomerAmount.minorUnits,
    currency: "GBP",
    checkedAt,
    expiresAt,
    finalTermsVerified: true,
    taxesFeesKnown: true,
    eligibility: "verified",
    availability: "verified",
    accessibility: "verified",
    constraintEvidence: [],
    bookingSupported: true,
    occupancy: entry.type === "accommodation" ? { adults: 2, childAges: [], rooms: 1 } : null,
    travellerReadiness: {
      reference: "recorded-travellers",
      version: "1",
      fingerprint: "a".repeat(64),
    },
    paymentReadiness: { reference: "recorded-payment", version: "1", fingerprint: "b".repeat(64) },
    confirmationId: null,
  }));
  return { snapshot: tripSnapshotSchema.parse(snapshot), evidence, travellerIds };
}

export function wholeTripTermsFixture(fixture = wholeTripReviewFixture(), now = reviewNow) {
  const { snapshot, evidence } = fixture;
  const { confirmedByUser, ...departureOrigin } = snapshot.departureOrigin!;
  if (!confirmedByUser) throw new Error("The complete review fixture requires confirmed origin");
  return {
    schemaVersion: 2 as const,
    tripVersion: 2,
    departureOrigin,
    travellerParty: snapshot.travellerParty,
    coverage: deriveBookingCoverage(snapshot, { tripVersion: 2, evidence, now }),
    continuationOf: null,
    rootAttemptId: null,
    components: snapshot.components.map((component) => {
      const proof = evidence.find((entry) => entry.componentId === component.id)!;
      return {
        componentId: component.id,
        supplierOfferId: component.supplierOfferId,
        inventoryId: proof.inventoryId,
        provider: component.provider,
        attribution: { provider: component.provider, sourceUrl: null },
        disposition:
          component.bookingStatus === "confirmed"
            ? ("already_confirmed" as const)
            : ("to_book" as const),
        confirmationId: proof.confirmationId,
        serviceStart: component.serviceStart,
        serviceEnd: component.serviceEnd,
        travellerIds: component.travellerIds,
        finalCustomerMinor: proof.finalCustomerMinor,
        taxesMinor: 0,
        feesMinor: 0,
        currency: proof.currency,
        cancellationTerms: component.cancellationTerms,
        expiresAt: component.expiresAt!,
        nonReversible: false,
        service: {
          type: component.type,
          title: `Recorded ${component.type}`,
          timezone: "Europe/Lisbon",
          propertyId: component.type === "accommodation" ? "recorded-property" : null,
          propertyType: component.type === "accommodation" ? "hotel" : null,
          roomIds: component.type === "accommodation" ? ["recorded-room"] : [],
          fare: component.type === "flight" ? "Recorded fare" : null,
          baggage: component.type === "flight" ? ["One cabin bag"] : [],
          refundTerms: "Recorded refund terms",
          changeTerms: "Recorded change terms",
          taxFeeInclusion: "All mandatory customer taxes and fees included",
          occupancy: proof.occupancy,
        },
        evidence: proof,
      };
    }),
    totalPrice: {
      currency: snapshot.price.currency,
      minorUnits: evidence
        .filter((entry) => !entry.confirmationId)
        .reduce((sum, entry) => sum + entry.finalCustomerMinor, 0),
    },
    nonReversibleActions: [] as string[],
  };
}

export function publicWholeTripReviewFixture() {
  const fixture = wholeTripReviewFixture();
  const terms = bookingTermsV2Schema.parse(wholeTripTermsFixture(fixture));
  const tripId = randomUUID(),
    workflowId = randomUUID(),
    authorizationId = randomUUID();
  const termsHash = hashBookingTerms(terms),
    expiresAt = terms.components[0].expiresAt;
  const state = bookingReviewStateSchema.parse({
    tripId,
    tripVersion: 2,
    coverage: terms.coverage,
    review: {
      workflowId,
      tripId,
      tripVersion: 2,
      status: "completed",
      outcomes: terms.components.map((entry) => ({
        componentId: entry.componentId,
        outcome: "unchanged",
      })),
      termsHash,
      terms: projectBookingTerms(terms),
      expiresAt,
      coverage: terms.coverage,
    },
    authorization: null,
    activeAttempt: null,
    latestAttempt: null,
    history: [],
    confirmedCommitments: [],
  });
  const authorization = {
    id: authorizationId,
    tripId,
    tripVersion: 2,
    operation: "book_trip" as const,
    componentId: null,
    termsHash,
    status: "authorized" as const,
    authorizedAt: reviewNow.toISOString(),
    expiresAt,
  };
  const booking = publicBookingTransactionSchema.parse({
    id: randomUUID(),
    tripId,
    authorizationId,
    operation: "book_trip",
    status: "requested",
    components: terms.components.map((entry) => ({
      componentId: entry.componentId,
      status: "not_attempted",
      providerReference: null,
      safeReason: "Whole-trip provider execution is not activated.",
    })),
    startedAt: reviewNow.toISOString(),
    completedAt: null,
    requestId: randomUUID(),
    executionStatus: "invalidated",
    tripVersion: 2,
    termsHash,
    termsVersion: 2,
    continuationOf: null,
    rootAttemptId: null,
  });
  return {
    state,
    authorization,
    booking,
    terms,
    trip: {
      tripId,
      version: 2,
      lifecycleState: "finalized",
      updatedAt: reviewNow.toISOString(),
      snapshot: projectCustomerSnapshot(fixture.snapshot),
    },
  };
}
