// @vitest-environment node
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { bookingTermsSchema, hashBookingTerms, projectBookingTerms } from "../../domain/booking/authorization";
import { bookingTransactionSchema, projectBookingTransactionRow } from "../../domain/booking/schema";
import { ProblemError, problemResponse } from "../../server/errors";
import { allowlistedTelemetryAttributes } from "../../server/telemetry";

const componentId = randomUUID();
const travellerId = randomUUID();
const terms = bookingTermsSchema.parse({
  departureOrigin: { kind: "airport", placeId: "airport:lhr", name: "Synthetic London Airport",
    countryCode: "GB", timezone: "Europe/London", airportCode: "LHR" },
  travellerParty: { adults: 1, children: [] },
  components: [{ componentId, supplierOfferId: "supplier-private-offer", inventoryId: "supplier-private-inventory",
    serviceStart: "2030-05-01T10:00:00Z", serviceEnd: "2030-05-01T12:00:00Z", travellerIds: [travellerId],
    finalCustomerMinor: 12500, taxesMinor: 1500, feesMinor: 500, currency: "GBP",
    cancellationTerms: "Refundable until 24 hours before service", expiresAt: "2030-04-30T10:00:00Z",
    nonReversible: false }],
  totalPrice: { currency: "GBP", minorUnits: 12500 }, nonReversibleActions: [],
});

describe("booking privacy boundaries", () => {
  it("projects customer-safe live terms without supplier identity or internal costs", () => {
    const publicTerms = projectBookingTerms(terms);
    const serialized = JSON.stringify(publicTerms);
    expect(serialized).not.toMatch(/supplierOfferId|inventoryId|supplierAmount|platformMargin|nonReversible"/);
    expect(publicTerms.components[0]).toMatchObject({ componentId, finalCustomerMinor: 12500, taxesMinor: 1500, feesMinor: 500 });
    expect(publicTerms.components[0].cancellationTerms).toContain("Refundable");
  });

  it("keeps the public booking status payload free of ownership and supplier facts", () => {
    const row = {
      id: randomUUID(), tripId: randomUUID(), ownerUserId: "user-1", authorizationId: randomUUID(),
      operation: "book_trip" as const, workflowId: "booking-1", requestId: randomUUID(), status: "running" as const,
      components: [{ componentId, status: "authorized", providerReference: null, safeReason: null }],
      executionBasis: { ownerUserId: "user-1", operation: "book_trip" as const, authorizationId: randomUUID(),
        startingTripVersion: 3, terms, termsHash: hashBookingTerms(terms), expiresAt: "2030-04-30T10:00:00Z" },
      lastObservedTripVersion: 3, executionStatus: "active" as const,
      startedAt: new Date("2030-04-29T10:00:00Z"), completedAt: null,
    };
    const booking = projectBookingTransactionRow(row);
    expect(Object.keys(booking)).not.toContain("ownerUserId");
    expect(bookingTransactionSchema.safeParse({ ...booking, ownerUserId: "user-1" }).success).toBe(false);

    // The status route returns only an execution summary beside the component outcomes.
    const payload = { ...booking, currentTripVersion: booking.lastObservedTripVersion,
      executionBasis: { tripVersion: booking.executionBasis.startingTripVersion,
        termsHash: booking.executionBasis.termsHash, expiresAt: booking.executionBasis.expiresAt } };
    expect(JSON.stringify(payload.executionBasis)).not.toMatch(/supplier|margin|travellerIds|terms":/);
  });

  it("never echoes provider or traveller detail through an error envelope", () => {
    const leaked = "supplier 991199 margin 883388 card 4111111111111111";
    const response = problemResponse(new Error(leaked), randomUUID());
    return response.text().then((body) => {
      expect(body).not.toContain("991199");
      expect(body).not.toContain("883388");
      expect(body).not.toContain("4111111111111111");
      expect(JSON.parse(body)).toMatchObject({ code: "internal_error" });
    });
  });

  it("drops supplier, margin, payment and traveller attributes from telemetry", () => {
    const allowed = allowlistedTelemetryAttributes({
      "onholidai.workflow_id": "booking-1", "onholidai.trip_id": "trip-1", "onholidai.outcome": "confirmed",
      supplierTotal: 991199, platformMargin: 883388, paymentToken: "tok_live_1", passportNumber: "X1234567",
      travellerIds: [travellerId], terms,
    });
    expect(allowed).toEqual({ "onholidai.workflow_id": "booking-1", "onholidai.trip_id": "trip-1", "onholidai.outcome": "confirmed" });
  });

  it("keeps booking errors safe while retaining the actionable problem code", () => {
    const response = problemResponse(new ProblemError({ title: "Booking authorization is stale or expired",
      status: 409, code: "booking_authorization_stale" }), randomUUID());
    return response.text().then((body) => {
      expect(JSON.parse(body)).toMatchObject({ status: 409, code: "booking_authorization_stale" });
      expect(body).not.toMatch(/supplier|margin|payment|passport/i);
    });
  });
});
