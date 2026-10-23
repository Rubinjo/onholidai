// @vitest-environment node
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  assertAuthorizationTerms,
  bookingTermsSchema,
  hashBookingTerms,
  projectBookingTerms,
  type BookingAuthorization,
} from "../../domain/booking/authorization";
import { bookingAuthorizationRequestSchema } from "../../domain/booking/authorize";
import { normalizeTransactionOutcome } from "../../server/supply/transactions";
import { wholeTripReviewFixture, wholeTripTermsFixture } from "../fixtures/whole-trip-review";

vi.mock("server-only", () => ({}));

const componentId = "10000000-0000-4000-8000-000000000001";
const travellerId = "11000000-0000-4000-8000-000000000001";
const terms = {
  departureOrigin: {
    kind: "airport" as const,
    placeId: "airport:lhr",
    name: "London Heathrow",
    countryCode: "GB",
    timezone: "Europe/London",
    airportCode: "LHR",
  },
  travellerParty: { adults: 1, children: [] },
  components: [
    {
      componentId,
      supplierOfferId: "private-offer-id",
      inventoryId: "private-inventory-id",
      serviceStart: "2030-05-01T10:00:00Z",
      serviceEnd: "2030-05-01T12:00:00Z",
      travellerIds: [travellerId],
      finalCustomerMinor: 12500,
      taxesMinor: 1500,
      feesMinor: 500,
      currency: "GBP",
      cancellationTerms: "Refundable until 24 hours before service",
      expiresAt: "2030-04-30T10:00:00Z",
      nonReversible: false,
    },
  ],
  totalPrice: { currency: "GBP", minorUnits: 12500 },
  nonReversibleActions: [],
};

describe("booking API term contract", () => {
  it("accepts only complete v2 terms and counts durable commitments separately from payable work", () => {
    const fixture = wholeTripReviewFixture();
    const terms = wholeTripTermsFixture(fixture);
    expect(bookingTermsSchema.safeParse(terms).success).toBe(true);
    fixture.snapshot.components[0].bookingStatus = "confirmed";
    fixture.evidence[0].confirmationId = "recorded-durable-confirmation";
    fixture.evidence[0].expiresAt = null;
    const partiallyBooked = bookingTermsSchema.parse(wholeTripTermsFixture(fixture));
    expect(partiallyBooked.totalPrice.minorUnits).toBe(30000);
    expect(
      bookingTermsSchema.safeParse({
        ...terms,
        coverage: { ...terms.coverage, complete: false },
      }).success,
    ).toBe(false);
    expect(
      bookingTermsSchema.safeParse({ ...terms, totalPrice: { currency: "GBP", minorUnits: 45000 } })
        .success,
    ).toBe(false);
  });

  it.each([
    "provider",
    "offer",
    "inventory",
    "property",
    "room",
    "fare",
    "baggage",
    "refund",
    "change",
    "taxes",
    "party",
    "dates",
    "readiness",
    "mapping",
    "lineage",
  ])("binds v2 %s evidence instead of authorizing a replacement or subset", (field) => {
    const original = wholeTripTermsFixture();
    const parsed = bookingTermsSchema.parse(original);
    const changed = structuredClone(original);
    switch (field) {
      case "provider":
        changed.components[0].provider = "nuitee";
        break;
      case "offer":
        changed.components[0].supplierOfferId += "-changed";
        break;
      case "inventory":
        changed.components[0].inventoryId += "-changed";
        break;
      case "property":
        changed.components[2].service.propertyId = "different-property";
        break;
      case "room":
        changed.components[2].service.roomIds = ["different-room"];
        break;
      case "fare":
        changed.components[0].service.fare = "Different fare";
        break;
      case "baggage":
        changed.components[0].service.baggage = ["No baggage"];
        break;
      case "refund":
        changed.components[0].service.refundTerms = "Non-refundable";
        break;
      case "change":
        changed.components[0].service.changeTerms = "No changes";
        break;
      case "taxes":
        changed.components[0].taxesMinor = 200;
        break;
      case "party":
        changed.components[0].travellerIds = [changed.components[0].travellerIds[0]];
        break;
      case "dates":
        changed.components[0].serviceEnd = "2030-01-02T13:00:00Z";
        break;
      case "readiness":
        changed.components[0].evidence.travellerReadiness!.version = "2";
        break;
      case "mapping":
        changed.coverage.entries.pop();
        break;
      case "lineage":
        Object.assign(changed, { continuationOf: componentId });
        break;
    }
    const result = bookingTermsSchema.safeParse(changed);
    expect(!result.success || hashBookingTerms(result.data) !== hashBookingTerms(parsed)).toBe(
      true,
    );
  });

  it("preserves the original v1 canonical hash and JSON without adding a discriminator", () => {
    const parsed = bookingTermsSchema.parse(terms);
    expect(parsed).toEqual(terms);
    expect(hashBookingTerms(parsed)).toMatchInlineSnapshot(
      `"9ef0fa35165467949310529dce2574835e317db4a983ee543914e6ae75dabccb"`,
    );
  });

  it("rejects component-subset consent and duplicate acknowledgements before booking", () => {
    const request = {
      requestId: "20000000-0000-4000-8000-000000000001",
      tripVersion: 8,
      termsHash: "a".repeat(64),
      operation: "book_trip",
      componentId: null,
      acknowledgedNonReversibleActions: [],
    };
    expect(bookingAuthorizationRequestSchema.safeParse(request).success).toBe(true);
    expect(bookingAuthorizationRequestSchema.safeParse({ ...request, componentId }).success).toBe(
      false,
    );
    expect(
      bookingAuthorizationRequestSchema.safeParse({
        ...request,
        acknowledgedNonReversibleActions: [componentId, componentId],
      }).success,
    ).toBe(false);
  });

  it("binds exact canonical live terms and checks authorization scope, version, expiry and hash", () => {
    const parsed = bookingTermsSchema.parse(terms),
      termsHash = hashBookingTerms(parsed);
    const authorization: BookingAuthorization = {
      id: "20000000-0000-4000-8000-000000000001",
      tripId: "30000000-0000-4000-8000-000000000001",
      userId: "user-1",
      tripVersion: 8,
      operation: "book_trip",
      componentId: null,
      terms: parsed,
      termsHash,
      acknowledgedNonReversibleActions: [],
      status: "authorized",
      reason: null,
      authorizedAt: "2030-04-29T10:00:00Z",
      expiresAt: "2030-04-30T10:00:00Z",
    };
    expect(() =>
      assertAuthorizationTerms({
        authorization,
        ownerUserId: "user-1",
        tripVersion: 8,
        operation: "book_trip",
        componentId: null,
        now: new Date("2030-04-29T12:00:00Z"),
      }),
    ).not.toThrow();
    expect(() =>
      assertAuthorizationTerms({
        authorization,
        ownerUserId: "other",
        tripVersion: 8,
        operation: "book_trip",
        componentId: null,
        now: new Date("2030-04-29T12:00:00Z"),
      }),
    ).toThrow();
    expect(() =>
      assertAuthorizationTerms({
        authorization,
        ownerUserId: "user-1",
        tripVersion: 9,
        operation: "book_trip",
        componentId: null,
        now: new Date("2030-04-29T12:00:00Z"),
      }),
    ).toThrow();
  });

  it("rejects inconsistent totals and projects only customer-safe terms", () => {
    expect(
      bookingTermsSchema.safeParse({ ...terms, totalPrice: { currency: "GBP", minorUnits: 12499 } })
        .success,
    ).toBe(false);
    const publicTerms = projectBookingTerms(bookingTermsSchema.parse(terms));
    expect(JSON.stringify(publicTerms.components)).not.toMatch(
      /supplierOfferId|inventoryId|nonReversible/,
    );
    expect(JSON.stringify(publicTerms)).not.toMatch(/supplierAmount|platformMargin/);
    expect(publicTerms.nonReversibleActions).toEqual([]);
    expect(publicTerms.totalPrice.minorUnits).toBe(12500);
  });

  it("scopes each component operation to its own authorization", () => {
    const componentOperation = {
      requestId: "20000000-0000-4000-8000-000000000001",
      tripVersion: 8,
      termsHash: "a".repeat(64),
      operation: "cancel_component",
      componentId,
      acknowledgedNonReversibleActions: [],
    };
    expect(bookingAuthorizationRequestSchema.safeParse(componentOperation).success).toBe(true);
    expect(
      bookingAuthorizationRequestSchema.safeParse({
        ...componentOperation,
        operation: "reschedule_component",
      }).success,
    ).toBe(true);
    expect(
      bookingAuthorizationRequestSchema.safeParse({ ...componentOperation, termsHash: "short" })
        .success,
    ).toBe(false);
    expect(
      bookingAuthorizationRequestSchema.safeParse({ ...componentOperation, book: true }).success,
    ).toBe(false);
  });

  it("normalizes every provider outcome to a customer-safe per-component state", () => {
    expect(
      normalizeTransactionOutcome({
        status: "confirmed",
        providerReference: "ref",
        evidenceId: "ev",
        confirmedTerms: {},
      }),
    ).toMatchObject({ status: "confirmed", providerReference: "ref", evidenceId: "ev" });
    expect(normalizeTransactionOutcome({ status: "failed" })).toMatchObject({ status: "failed" });
    expect(normalizeTransactionOutcome({ status: "unknown" })).toMatchObject({ status: "unknown" });
    expect(normalizeTransactionOutcome({ status: "action_required" })).toMatchObject({
      status: "action_required",
    });
    // A malformed or contradictory provider response becomes unknown rather than assumed success.
    expect(
      normalizeTransactionOutcome({ status: "confirmed", providerReference: "", evidenceId: "ev" }),
    ).toMatchObject({ status: "unknown" });
    expect(normalizeTransactionOutcome({ status: "booked" })).toMatchObject({ status: "unknown" });
    expect(normalizeTransactionOutcome(null)).toMatchObject({ status: "unknown" });
  });

  it("documents every additive booking route in the committed web contract", async () => {
    const contract = await readFile(
      new URL("../../../contracts/trip-domain/web-api.openapi.yaml", import.meta.url),
      "utf8",
    );
    for (const path of [
      "/trips/{tripId}/booking/revalidations",
      "/trips/{tripId}/booking/authorizations",
      "/trips/{tripId}/bookings",
      "/booking/revalidations/{workflowId}",
      "/bookings/{bookingId}",
      "/bookings/{bookingId}/components/{componentId}/recovery",
      "/bookings/{bookingId}/components/{componentId}/cancellations",
      "/bookings/{bookingId}/components/{componentId}/reschedule-revalidations",
      "/bookings/{bookingId}/components/{componentId}/reschedule-authorizations",
      "/bookings/{bookingId}/components/{componentId}/reschedules",
    ]) {
      expect(contract).toContain(`${path}:`);
    }
  });
});
