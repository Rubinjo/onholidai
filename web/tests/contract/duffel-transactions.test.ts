// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  bookingTermsV1Schema,
  bookingTermsV2ComponentSchema,
  canonicalBookingJson,
} from "../../domain/booking/authorization";
import { createDuffelTransactionAdapter } from "../../server/supply/providers/duffel-transactions";
import {
  createDuffelTransactionHttpClient,
  duffelPassengerIdentityFingerprint,
  type DuffelTransactionHttpOptions,
} from "../../server/supply/providers/duffel-transaction-http";
import { wholeTripTermsFixture } from "../fixtures/whole-trip-review";

import type { ProviderWriteRequest } from "../../server/supply/transactions";

vi.mock("server-only", () => ({}));

function adapter(options: DuffelTransactionHttpOptions) {
  return createDuffelTransactionAdapter(createDuffelTransactionHttpClient(options));
}

function fixture() {
  const terms = bookingTermsV2ComponentSchema.parse(
    wholeTripTermsFixture().components.find((entry) => entry.provider === "duffel"),
  );
  terms.supplierOfferId = "off_synthetic";
  terms.evidence.supplierOfferId = terms.supplierOfferId;
  const request: ProviderWriteRequest = {
    operation: "book_trip",
    componentId: terms.componentId,
    supplierOfferId: terms.supplierOfferId,
    inventoryId: terms.inventoryId,
    idempotencyKey: "synthetic-attempt:flight:book_trip:terms",
    requestFingerprint: createHash("sha256")
      .update(canonicalBookingJson({ operation: "book_trip", terms }))
      .digest("hex"),
    terms,
  };
  const passengers = terms.travellerIds.map((_id, index) => ({
    id: `pas_synthetic${index}`,
    given_name: "Synthetic",
    family_name: `Traveller${index}`,
    born_on: "1990-01-01",
    gender: "m" as const,
    title: "mr" as const,
    email: `synthetic${index}@example.invalid`,
    phone_number: "+10000000000",
  }));
  const fares = passengers.map((passenger) => ({
    passengerId: passenger.id,
    cabinClass: "economy",
    cabinName: "Economy",
    baggages: [{ type: "carry_on" as const, quantity: 1 }],
    seat: null,
  }));
  const conditions = { refund_before_departure: { allowed: true, penalty_amount: "0.00" } };
  const segment = {
    departingAt: new Date(terms.serviceStart).toISOString(),
    arrivingAt: new Date(terms.serviceEnd).toISOString(),
    originAirport: "LHR",
    destinationAirport: "LIS",
    operatingCarrierId: "arl_synthetic",
    operatingCarrierName: "Synthetic Airline",
    marketingCarrierId: "arl_synthetic",
    marketingFlightNumber: "123",
    passengers: fares,
  };
  const confirmation = {
    offerId: terms.supplierOfferId,
    liveMode: false,
    currency: "GBP",
    providerTotalMinor: 8000,
    providerBaseMinor: 7000,
    providerTaxMinor: 1000,
    conditions,
    slices: [{ conditions, fareBrand: "Economy", segments: [segment] }],
    passengers: passengers.map((passenger) => ({
      id: passenger.id,
      type: "adult",
      identityFingerprint: duffelPassengerIdentityFingerprint(passenger),
    })),
  };
  const basis = {
    idempotencyKey: request.idempotencyKey,
    requestFingerprint: request.requestFingerprint,
    supplierOfferId: terms.supplierOfferId,
    inventoryId: terms.inventoryId,
    travellerPassengers: passengers.map((passenger, index) => ({
      travellerId: terms.travellerIds[index],
      passengerId: passenger.id,
    })),
    confirmation,
  };
  const input = {
    ...basis,
    identityDocumentsRequired: false,
    payload: {
      passengers,
      payment: { type: "balance", amount: "80.00", currency: "GBP" },
    },
  };
  const data = structuredClone({
    id: "ord_synthetic",
    offer_id: terms.supplierOfferId,
    live_mode: false,
    metadata: {
      onholidai_attempt: createHash("sha256").update(request.idempotencyKey).digest("hex"),
      onholidai_fingerprint: request.requestFingerprint,
    },
    booking_reference: "SYNTHETIC",
    payment_status: { awaiting_payment: false, paid_at: "2029-11-01T00:00:00Z" },
    cancelled_at: null,
    cancellation: null,
    changes: [],
    airline_initiated_changes: [],
    total_amount: "80.00",
    total_currency: "GBP",
    base_amount: "70.00",
    base_currency: "GBP",
    tax_amount: "10.00",
    tax_currency: "GBP",
    conditions,
    services: [],
    passengers: passengers.map((passenger) => ({ ...passenger, type: "adult" })),
    slices: [
      {
        conditions,
        fare_brand_name: "Economy",
        segments: [
          {
            departing_at: segment.departingAt.slice(0, 19),
            arriving_at: segment.arrivingAt.slice(0, 19),
            origin: { iata_code: "LHR", time_zone: "Europe/London" },
            destination: { iata_code: "LIS", time_zone: "Europe/Lisbon" },
            operating_carrier: { id: "arl_synthetic", name: "Synthetic Airline" },
            marketing_carrier: { id: "arl_synthetic" },
            marketing_carrier_flight_number: "123",
            passengers: fares.map((fare) => ({
              passenger_id: fare.passengerId,
              cabin_class: fare.cabinClass,
              cabin_class_marketing_name: fare.cabinName,
              baggages: fare.baggages,
              seat: fare.seat,
            })),
          },
        ],
      },
    ],
  });
  const transport = vi.fn<typeof fetch>(async () => Response.json({ data }));
  const resolveBooking = vi.fn<NonNullable<DuffelTransactionHttpOptions["resolveBooking"]>>(
    async () => structuredClone(input),
  );
  const options: DuffelTransactionHttpOptions = {
    writeToken: "duffel_test_synthetic-private",
    environment: "sandbox",
    approval: {
      environment: "sandbox",
      bookingEvidenceRef: "synthetic-booking-approval",
      statusEvidenceRef: "synthetic-status-approval",
      finalTermsEvidenceRef: "synthetic-final-terms-approval",
      paymentMethods: ["balance"],
    },
    resolveBooking,
    resolveStatus: async () => structuredClone(basis),
    fetch: transport,
    now: () => new Date("2029-11-01T00:00:00Z"),
  };
  const context = {
    componentId: request.componentId,
    providerReference: data.id,
    terms: request.terms,
  };
  return { request, input, basis, data, options, context, transport, resolveBooking };
}

describe("restricted Duffel instant flight order and saved-order status", () => {
  it("uses only the approved instant-order/balance-payment fields and returns no private identities", async () => {
    const f = fixture();
    const client = adapter(f.options);
    const result = await client.execute(f.request);
    expect(result).toMatchObject({
      status: "confirmed",
      providerReference: "ord_synthetic",
      confirmedTerms: f.request.terms,
    });
    expect(client.capabilities).toEqual({
      book: true,
      status: true,
      cancel: false,
      reschedule: false,
      idempotency: false,
      revalidation: "unsupported",
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
    const [url, init] = f.transport.mock.calls[0];
    expect(url).toBe("https://api.duffel.com/air/orders");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: {
        Authorization: "Bearer duffel_test_synthetic-private",
        "Duffel-Version": "v2",
      },
    });
    expect(JSON.parse(String(init!.body))).toEqual({
      data: {
        type: "instant",
        selected_offers: [f.request.supplierOfferId],
        passengers: f.input.payload.passengers,
        payments: [f.input.payload.payment],
        metadata: f.data.metadata,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /@example.invalid|Traveller0|1990-01-01|duffel_test_synthetic-private|providerTotalMinor/,
    );
  });

  it.each([
    "approval",
    "booking",
    "final_terms",
    "payment",
    "resolver",
    "environment",
    "key",
  ] as const)("does not enable booking without approved %s", async (missing) => {
    const f = fixture();
    const approval = f.options.approval!;
    const options = {
      ...f.options,
      ...(missing === "approval" ? { approval: undefined } : {}),
      ...(missing === "booking"
        ? { approval: { ...approval, bookingEvidenceRef: undefined } }
        : {}),
      ...(missing === "final_terms"
        ? { approval: { ...approval, finalTermsEvidenceRef: undefined } }
        : {}),
      ...(missing === "payment" ? { approval: { ...approval, paymentMethods: [] } } : {}),
      ...(missing === "resolver" ? { resolveBooking: undefined } : {}),
      ...(missing === "environment"
        ? { approval: { ...approval, environment: "production" as const } }
        : {}),
      ...(missing === "key" ? { writeToken: "duffel_live_synthetic-private" } : {}),
    };
    const client = adapter(options);
    expect(client.capabilities.book).toBe(false);
    await expect(client.execute(f.request)).rejects.toMatchObject({
      code: "booking_prerequisites_unavailable",
    });
    expect(f.resolveBooking).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([
    "attempt",
    "fingerprint",
    "offer",
    "inventory",
    "party",
    "passenger",
    "identity",
    "payment",
    "payment_currency",
    "missing_passport",
    "extra_payload",
  ] as const)("rejects unbound private %s before network dispatch", async (change) => {
    const f = fixture();
    const input = structuredClone(f.input);
    if (change === "attempt") input.idempotencyKey = "another-attempt";
    if (change === "fingerprint") input.requestFingerprint = "0".repeat(64);
    if (change === "offer") input.supplierOfferId = "off_other";
    if (change === "inventory") input.inventoryId = "another-inventory";
    if (change === "party") input.travellerPassengers[0].travellerId = crypto.randomUUID();
    if (change === "passenger") input.payload.passengers[0].id = "pas_other";
    if (change === "identity") input.payload.passengers[0].family_name = "Another";
    if (change === "payment") input.payload.payment.amount = "90.00";
    if (change === "payment_currency") input.payload.payment.currency = "USD";
    if (change === "missing_passport") input.identityDocumentsRequired = true;
    f.resolveBooking.mockResolvedValue(
      change === "extra_payload"
        ? { ...input, payload: { ...input.payload, type: "hold" } }
        : input,
    );
    await expect(adapter(f.options).execute(f.request)).rejects.toMatchObject({
      code: "booking_prerequisites_unavailable",
    });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 409, 422, 429, 500, 503])(
    "never treats HTTP %s as proof of no booking or automatically retries",
    async (status) => {
      const f = fixture();
      f.transport.mockResolvedValue(
        Response.json({ errors: [{ code: "private-provider-canary" }] }, { status }),
      );
      const result = await adapter(f.options).execute(f.request);
      expect(result.status).toBe("unknown");
      expect(JSON.stringify(result)).not.toContain("private-provider-canary");
      expect(f.transport).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "price",
    "currency",
    "offer",
    "unpaid",
    "no_paid_at",
    "cancelled",
    "change",
    "airline_change",
    "services",
    "passenger",
    "baggage",
    "route",
    "policy",
  ] as const)(
    "retains a correlated order reference without inventing unchanged %s",
    async (change) => {
      const f = fixture();
      if (change === "price") f.data.total_amount = "90.00";
      if (change === "currency") f.data.total_currency = "USD";
      if (change === "offer") f.data.offer_id = "off_other";
      if (change === "unpaid") f.data.payment_status.awaiting_payment = true;
      const data =
        change === "no_paid_at"
          ? { ...f.data, payment_status: { awaiting_payment: false, paid_at: null } }
          : change === "cancelled"
            ? { ...f.data, cancelled_at: "2029-11-01T00:00:00Z" }
            : change === "change"
              ? { ...f.data, changes: [{}] }
              : change === "airline_change"
                ? { ...f.data, airline_initiated_changes: [{}] }
                : change === "services"
                  ? { ...f.data, services: [{}] }
                  : f.data;
      if (change === "passenger") f.data.passengers[0].family_name = "Another";
      if (change === "baggage") f.data.slices[0].segments[0].passengers[0].baggages[0].quantity = 2;
      if (change === "route") f.data.slices[0].segments[0].destination.iata_code = "MAD";
      if (change === "policy")
        f.data.conditions = {
          refund_before_departure: { allowed: false, penalty_amount: "80.00" },
        };
      f.transport.mockResolvedValue(Response.json({ data }));
      await expect(adapter(f.options).execute(f.request)).resolves.toMatchObject({
        status: "confirmed",
        providerReference: "ord_synthetic",
        confirmedTerms: null,
      });
    },
  );

  it("requires matching request metadata to correlate a newly returned order", async () => {
    const f = fixture();
    f.data.metadata.onholidai_attempt = "0".repeat(64);
    expect((await adapter(f.options).execute(f.request)).status).toBe("unknown");
  });

  it("reads the saved order after consent expiry with status-only access and mutable metadata", async () => {
    const f = fixture();
    f.data.metadata.onholidai_attempt = "0".repeat(64);
    const client = adapter({
      ...f.options,
      approval: {
        environment: "sandbox",
        statusEvidenceRef: "synthetic-status",
        paymentMethods: [],
      },
      resolveBooking: undefined,
      now: () => new Date("2031-01-01T00:00:00Z"),
    });
    expect(client.capabilities.book).toBe(false);
    expect(client.capabilities.status).toBe(true);
    await expect(client.getStatus!(f.request.idempotencyKey, f.context)).resolves.toMatchObject({
      status: "confirmed",
      confirmedTerms: f.request.terms,
    });
    expect(f.transport.mock.calls[0][0]).toBe("https://api.duffel.com/air/orders/ord_synthetic");
    expect(f.transport.mock.calls[0][1]).toMatchObject({ method: "GET", body: undefined });
  });

  it.each([null, "../escape", "ord_synthetic?x=1", "https://unapproved.invalid"])(
    "does not guess an order or forward unsafe status reference %s",
    async (providerReference) => {
      const f = fixture();
      const result = await adapter(f.options).getStatus!(f.request.idempotencyKey, {
        ...f.context,
        providerReference,
      });
      expect(result.status).toBe("action_required");
      expect(f.transport).not.toHaveBeenCalled();
    },
  );

  it("preserves an authenticated saved reference when the original private source is unavailable", async () => {
    const f = fixture();
    const result = await adapter({ ...f.options, resolveStatus: undefined }).getStatus!(
      f.request.idempotencyKey,
      f.context,
    );
    expect(result).toMatchObject({
      status: "confirmed",
      providerReference: "ord_synthetic",
      confirmedTerms: null,
    });
  });

  it("leaves timeout-after-commit uncertain with no repeat or guessed status request", async () => {
    const f = fixture();
    f.transport.mockImplementation(async () => new Promise<Response>(() => {}));
    const client = adapter({ ...f.options, timeoutMs: 10 });
    expect((await client.execute(f.request)).status).toBe("unknown");
    expect(
      (await client.getStatus!(f.request.idempotencyKey, { ...f.context, providerReference: null }))
        .status,
    ).toBe("action_required");
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it("does not turn malformed local timestamps into apparently matching instants", async () => {
    const f = fixture();
    f.data.slices[0].segments[0].departing_at += "-invalid-suffix";
    await expect(adapter(f.options).execute(f.request)).resolves.toMatchObject({
      status: "confirmed",
      providerReference: "ord_synthetic",
      confirmedTerms: null,
    });
  });

  it.each(["80.001", "9007199254740992", "-1"])(
    "rejects invalid private payment amount %s with an explicit safe prerequisite problem",
    async (amount) => {
      const f = fixture();
      f.input.payload.payment.amount = amount;
      await expect(adapter(f.options).execute(f.request)).rejects.toMatchObject({
        code: "booking_prerequisites_unavailable",
      });
      expect(f.transport).not.toHaveBeenCalled();
    },
  );

  it.each(["-1", "80.001", "9007199254740992"])(
    "preserves a real order reference rather than rounding invalid actual amount %s",
    async (amount) => {
      const f = fixture();
      f.data.total_amount = amount;
      await expect(adapter(f.options).execute(f.request)).resolves.toMatchObject({
        status: "confirmed",
        providerReference: "ord_synthetic",
        confirmedTerms: null,
      });
    },
  );

  it("rejects a self-linked infant passenger before calling the provider", async () => {
    const f = fixture();
    f.resolveBooking.mockResolvedValue({
      ...f.input,
      payload: {
        ...f.input.payload,
        passengers: f.input.payload.passengers.map((passenger) => ({
          ...passenger,
          infant_passenger_id: passenger.id,
        })),
      },
    });
    await expect(adapter(f.options).execute(f.request)).rejects.toMatchObject({
      code: "booking_prerequisites_unavailable",
    });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("preserves legacy v1 order reconciliation but never creates a new v1 order", async () => {
    const f = fixture();
    const terms = bookingTermsV1Schema.shape.components.element.strip().parse(f.request.terms);
    const requestFingerprint = createHash("sha256")
      .update(canonicalBookingJson({ operation: "book_trip", terms }))
      .digest("hex");
    const client = adapter({
      ...f.options,
      resolveStatus: async () => ({ ...f.basis, requestFingerprint }),
    });
    await expect(client.execute({ ...f.request, terms, requestFingerprint })).rejects.toMatchObject(
      { code: "booking_prerequisites_unavailable" },
    );
    expect(f.resolveBooking).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    await expect(
      client.getStatus!(f.request.idempotencyKey, { ...f.context, terms }),
    ).resolves.toMatchObject({
      status: "confirmed",
      providerReference: "ord_synthetic",
      confirmedTerms: terms,
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.transport.mock.calls[0][1]!.method).toBe("GET");
  });

  it("isolates private booking sources from caller-owned request identity", async () => {
    const f = fixture();
    const original = structuredClone(f.request);
    f.resolveBooking.mockImplementation(async (request) => {
      request.idempotencyKey = "another-attempt";
      request.terms.finalCustomerMinor = 1;
      return f.input;
    });
    await expect(adapter(f.options).execute(f.request)).resolves.toMatchObject({
      status: "confirmed",
      confirmedTerms: original.terms,
    });
    expect(f.request).toEqual(original);
  });

  it("preserves an authenticated saved order if its private terms reader fails", async () => {
    const f = fixture();
    const result = await adapter({
      ...f.options,
      resolveStatus: async (_key, context) => {
        context.providerReference = "ord_other";
        throw new Error("synthetic0@example.invalid private-provider-canary");
      },
    }).getStatus!(f.request.idempotencyKey, f.context);
    expect(result).toMatchObject({
      status: "confirmed",
      providerReference: "ord_synthetic",
      confirmedTerms: null,
    });
    expect(f.context.providerReference).toBe("ord_synthetic");
    expect(JSON.stringify(result)).not.toMatch(/@example.invalid|private-provider-canary/);
  });
});
