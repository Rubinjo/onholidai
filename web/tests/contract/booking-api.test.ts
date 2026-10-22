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
