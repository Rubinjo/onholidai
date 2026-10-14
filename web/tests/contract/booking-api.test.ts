// @vitest-environment node
import { describe, expect, it } from "vitest";
import { assertAuthorizationTerms, bookingTermsSchema, hashBookingTerms, projectBookingTerms, type BookingAuthorization } from "../../domain/booking/authorization";

const componentId = "10000000-0000-4000-8000-000000000001";
const travellerId = "11000000-0000-4000-8000-000000000001";
const terms = {
  departureOrigin: { kind: "airport" as const, placeId: "airport:lhr", name: "London Heathrow", countryCode: "GB", timezone: "Europe/London", airportCode: "LHR" },
  travellerParty: { adults: 1, children: [] },
  components: [{ componentId, supplierOfferId: "private-offer-id", inventoryId: "private-inventory-id",
    serviceStart: "2030-05-01T10:00:00Z", serviceEnd: "2030-05-01T12:00:00Z", travellerIds: [travellerId],
    finalCustomerMinor: 12500, taxesMinor: 1500, feesMinor: 500, currency: "GBP",
    cancellationTerms: "Refundable until 24 hours before service", expiresAt: "2030-04-30T10:00:00Z", nonReversible: false }],
  totalPrice: { currency: "GBP", minorUnits: 12500 }, nonReversibleActions: [],
};

describe("booking API term contract", () => {
  it("binds exact canonical live terms and checks authorization scope, version, expiry and hash", () => {
    const parsed = bookingTermsSchema.parse(terms), termsHash = hashBookingTerms(parsed);
    const authorization: BookingAuthorization = { id: "20000000-0000-4000-8000-000000000001",
      tripId: "30000000-0000-4000-8000-000000000001", userId: "user-1", tripVersion: 8,
      operation: "book_trip", componentId: null, terms: parsed, termsHash,
      acknowledgedNonReversibleActions: [], status: "authorized", reason: null,
      authorizedAt: "2030-04-29T10:00:00Z", expiresAt: "2030-04-30T10:00:00Z" };
    expect(() => assertAuthorizationTerms({ authorization, ownerUserId: "user-1", tripVersion: 8,
      operation: "book_trip", componentId: null, now: new Date("2030-04-29T12:00:00Z") })).not.toThrow();
    expect(() => assertAuthorizationTerms({ authorization, ownerUserId: "other", tripVersion: 8,
      operation: "book_trip", componentId: null, now: new Date("2030-04-29T12:00:00Z") })).toThrow();
    expect(() => assertAuthorizationTerms({ authorization, ownerUserId: "user-1", tripVersion: 9,
      operation: "book_trip", componentId: null, now: new Date("2030-04-29T12:00:00Z") })).toThrow();
  });

  it("rejects inconsistent totals and projects only customer-safe terms", () => {
    expect(bookingTermsSchema.safeParse({ ...terms, totalPrice: { currency: "GBP", minorUnits: 12499 } }).success).toBe(false);
    const publicTerms = projectBookingTerms(bookingTermsSchema.parse(terms));
    expect(JSON.stringify(publicTerms)).not.toMatch(/supplierOfferId|inventoryId|nonReversible/);
    expect(JSON.stringify(publicTerms)).not.toMatch(/supplierAmount|platformMargin/);
    expect(publicTerms.totalPrice.minorUnits).toBe(12500);
  });
});
