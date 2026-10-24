// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  bookingTermsV2ComponentSchema,
  canonicalBookingJson,
} from "../../domain/booking/authorization";
import {
  createNuiteeTransactionHttpClient,
  type NuiteeTransactionHttpOptions,
} from "../../server/supply/providers/nuitee-transaction-http";
import { createNuiteeTransactionAdapter as createAdapter } from "../../server/supply/providers/nuitee-transactions";
import { wholeTripTermsFixture } from "../fixtures/whole-trip-review";
import { providerRequestFingerprint } from "../../server/supply/transactions";

import type { ProviderWriteRequest } from "../../server/supply/transactions";

vi.mock("server-only", () => ({}));

function createNuiteeTransactionAdapter(options: NuiteeTransactionHttpOptions) {
  return createAdapter(createNuiteeTransactionHttpClient(options));
}

function fixture() {
  const terms = bookingTermsV2ComponentSchema.parse(
    wholeTripTermsFixture().components.find((entry) => entry.provider === "nuitee"),
  );
  const request: ProviderWriteRequest = {
    operation: "book_trip",
    componentId: terms.componentId,
    supplierOfferId: terms.supplierOfferId,
    inventoryId: terms.inventoryId,
    idempotencyKey: "synthetic-attempt:synthetic-component:book_trip:terms",
    requestFingerprint: createHash("sha256")
      .update(canonicalBookingJson({ operation: "book_trip", terms }))
      .digest("hex"),
    terms,
  };
  const policy = { refundableTag: "RFN", cancelPolicyInfos: [] };
  const confirmation = {
    hotelId: terms.service.propertyId,
    checkin: "2030-01-02",
    checkout: "2030-01-03",
    currency: "GBP",
    providerTotalMinor: 8000,
    sellingPriceMinor: null,
    cancellationPolicies: policy,
    rooms: [
      {
        roomTypeId: "recorded-room",
        rateId: "synthetic-rate",
        boardType: "RO",
        adults: 2,
        childrenAges: [],
        cancellationPolicies: policy,
      },
    ],
  };
  const privateInput = {
    requestFingerprint: request.requestFingerprint,
    idempotencyKey: request.idempotencyKey,
    supplierOfferId: terms.supplierOfferId,
    inventoryId: terms.inventoryId,
    confirmation,
    payload: {
      prebookId: "synthetic-private-prebook",
      holder: {
        firstName: "Synthetic",
        lastName: "Holder",
        email: "holder@example.invalid",
        phone: "+10000000000",
      },
      guests: [{ occupancyNumber: 1, firstName: "Synthetic", lastName: "Guest" }],
      payment: { method: "WALLET" },
    },
  };
  const clientReference = `onholidai-${createHash("sha256").update(request.idempotencyKey).digest("hex")}`;
  const data = {
    bookingId: "synthetic-booking",
    clientReference,
    status: "CONFIRMED",
    hotel: { hotelId: confirmation.hotelId },
    checkin: confirmation.checkin,
    checkout: confirmation.checkout,
    currency: "GBP",
    price: 80,
    cancellationPolicies: policy,
    bookedRooms: [
      {
        roomType: { roomTypeId: "recorded-room" },
        rate: {
          rateId: "synthetic-rate",
          boardType: "RO",
          cancellationPolicies: policy,
        },
        adults: 2,
        children: 0,
        childrenAges: [],
      },
    ],
    holder: privateInput.payload.holder,
    commission: 15,
    remarks: "private-supplier-canary",
  };
  const approval = {
    environment: "sandbox" as const,
    bookingEvidenceRef: "synthetic-booking-approval",
    statusEvidenceRef: "synthetic-status-approval",
    finalTermsEvidenceRef: "synthetic-no-side-effect-final-terms-approval",
    paymentMethods: ["WALLET"] as const,
  };
  const transport = vi.fn<typeof fetch>(async () => Response.json({ data }));
  const resolveBooking = vi.fn<NonNullable<NuiteeTransactionHttpOptions["resolveBooking"]>>(
    async () => structuredClone(privateInput),
  );
  const resolveStatus = vi.fn(async () => ({
    requestFingerprint: request.requestFingerprint,
    idempotencyKey: request.idempotencyKey,
    supplierOfferId: terms.supplierOfferId,
    inventoryId: terms.inventoryId,
    confirmation,
  }));
  const options = {
    apiKey: "sand_synthetic-private-key",
    environment: "sandbox" as const,
    approval,
    resolveBooking,
    resolveStatus,
    fetch: transport,
    now: () => new Date("2029-11-01T00:00:00Z"),
  };
  const context = {
    componentId: request.componentId,
    providerReference: data.bookingId,
    terms: request.terms,
  };
  return {
    request,
    privateInput,
    data,
    options,
    context,
    transport,
    resolveBooking,
    clientReference,
  };
}

describe("restricted Nuitee hotel booking and authenticated status wire", () => {
  it("preserves long offer/rate identities through private booking and independent saved status", async () => {
    const f = fixture();
    const original = bookingTermsV2ComponentSchema.parse(f.request.terms);
    const offerId = `${"Q".repeat(1152)}+/==`;
    const rateId = "r".repeat(549);
    const terms = bookingTermsV2ComponentSchema.parse({
      ...original,
      supplierOfferId: offerId,
      evidence: { ...original.evidence, supplierOfferId: offerId },
    });
    f.request.terms = terms;
    f.request.supplierOfferId = offerId;
    f.request.requestFingerprint = providerRequestFingerprint(f.request);
    f.privateInput.requestFingerprint = f.request.requestFingerprint;
    f.privateInput.supplierOfferId = offerId;
    f.privateInput.confirmation.rooms[0].rateId = rateId;
    f.data.bookedRooms[0].rate.rateId = rateId;
    f.context.terms = terms;
    f.options.resolveStatus = vi.fn(async () => ({
      requestFingerprint: f.request.requestFingerprint,
      idempotencyKey: f.request.idempotencyKey,
      supplierOfferId: offerId,
      inventoryId: f.request.inventoryId,
      confirmation: structuredClone(f.privateInput.confirmation),
    }));
    const adapter = createNuiteeTransactionAdapter(f.options);
    expect(await adapter.execute(f.request)).toMatchObject({
      status: "confirmed",
      confirmedTerms: terms,
    });
    expect(await adapter.getStatus!(f.request.idempotencyKey, f.context)).toMatchObject({
      status: "confirmed",
      confirmedTerms: terms,
    });
    expect(f.transport).toHaveBeenCalledTimes(2);
  });

  it("sends only the documented booking fields and maps exact approved hotel terms", async () => {
    const f = fixture();
    const adapter = createNuiteeTransactionAdapter(f.options);
    const result = await adapter.execute(f.request);
    expect(result).toMatchObject({
      status: "confirmed",
      providerReference: "synthetic-booking",
      confirmedTerms: f.request.terms,
    });
    expect(adapter.capabilities).toEqual({
      book: true,
      status: true,
      cancel: false,
      reschedule: false,
      idempotency: false,
      revalidation: "unsupported",
    });
    expect(f.transport).toHaveBeenCalledTimes(1);
    const [url, init] = f.transport.mock.calls[0];
    expect(url).toBe("https://book.liteapi.travel/v3.0/rates/book");
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
      headers: { "X-API-Key": "sand_synthetic-private-key" },
    });
    expect(JSON.parse(String(init!.body))).toEqual({
      ...f.privateInput.payload,
      clientReference: f.clientReference,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /holder@example|private-supplier-canary|synthetic-private-prebook|commission|sand_synthetic/,
    );
  });

  it.each([
    "approval",
    "bookingEvidenceRef",
    "finalTermsEvidenceRef",
    "resolver",
    "payment",
  ] as const)("requires independent %s before resolving or calling a booking", async (missing) => {
    const f = fixture();
    const options = {
      ...f.options,
      ...(missing === "approval" ? { approval: undefined } : {}),
      ...(missing === "resolver" ? { resolveBooking: undefined } : {}),
      ...(missing === "payment" ? { approval: { ...f.options.approval, paymentMethods: [] } } : {}),
      ...(missing === "bookingEvidenceRef" || missing === "finalTermsEvidenceRef"
        ? { approval: { ...f.options.approval, [missing]: undefined } }
        : {}),
    };
    const adapter = createNuiteeTransactionAdapter(options);
    expect(adapter.capabilities.book).toBe(false);
    await expect(adapter.execute(f.request)).rejects.toMatchObject({
      code: "booking_prerequisites_unavailable",
    });
    expect(f.resolveBooking).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([
    "fingerprint",
    "attempt",
    "inventory",
    "offer",
    "property",
    "room",
    "occupancy",
    "guests",
    "payment",
    "raw_card",
    "extra_payload",
  ] as const)("rejects unbound or unapproved private %s before HTTP", async (change) => {
    const f = fixture();
    const input = structuredClone(f.privateInput);
    if (change === "fingerprint") input.requestFingerprint = "0".repeat(64);
    if (change === "attempt") input.idempotencyKey = "another-attempt";
    if (change === "inventory") input.inventoryId += "-other";
    if (change === "offer") input.supplierOfferId += "-other";
    if (change === "property") input.confirmation.hotelId = "another-hotel";
    if (change === "room") input.confirmation.rooms[0].roomTypeId = "another-room";
    if (change === "occupancy") input.confirmation.rooms[0].adults = 1;
    if (change === "guests") input.payload.guests[0].occupancyNumber = 2;
    if (change === "payment") input.payload.payment.method = "CREDIT";
    const value =
      change === "raw_card"
        ? { ...input, payload: { ...input.payload, payment: { method: "CREDIT_CARD", card: "x" } } }
        : change === "extra_payload"
          ? { ...input, payload: { ...input.payload, clientReference: "untrusted-replacement" } }
          : input;
    f.options.resolveBooking.mockResolvedValue(value);
    await expect(
      createNuiteeTransactionAdapter(f.options).execute(f.request),
    ).rejects.toMatchObject({
      code: "booking_prerequisites_unavailable",
    });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(["cancel_component", "reschedule_component"] as const)(
    "does not implement the separate %s product",
    async (operation) => {
      const f = fixture();
      await expect(
        createNuiteeTransactionAdapter(f.options).execute({ ...f.request, operation }),
      ).rejects.toMatchObject({ code: "booking_prerequisites_unavailable" });
      expect(f.transport).not.toHaveBeenCalled();
    },
  );

  it("blocks stale quotes and mismatched request envelopes before private resolution", async () => {
    const f = fixture();
    for (const request of [
      { ...f.request, componentId: "different-component" },
      { ...f.request, inventoryId: "different-inventory" },
      { ...f.request, requestFingerprint: "0".repeat(64) },
      {
        ...f.request,
        terms: { ...f.request.terms, expiresAt: "2020-01-01T00:00:00Z" },
      },
    ]) {
      await expect(
        createNuiteeTransactionAdapter(f.options).execute(request),
      ).rejects.toMatchObject({ code: "booking_prerequisites_unavailable" });
    }
    expect(f.resolveBooking).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 409, 429, 500, 503])(
    "treats HTTP %s, including duplicate-reference 4005, as unresolved without retries",
    async (status) => {
      const f = fixture();
      f.transport.mockImplementation(async () =>
        Response.json({ error: { code: 4005, message: "private-supplier-canary" } }, { status }),
      );
      const result = await createNuiteeTransactionAdapter(f.options).execute(f.request);
      expect(result.status).toBe("unknown");
      expect(JSON.stringify(result)).not.toContain("private-supplier-canary");
      expect(f.transport).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    "transport",
    "malformed",
    "duplicate",
    "pending",
    "wrong_reference",
    "missing_reference",
  ])("keeps %s unresolved and never repeats a write", async (fault) => {
    const f = fixture();
    if (fault === "transport") f.transport.mockRejectedValue(new Error("private-supplier-canary"));
    if (fault === "malformed") f.transport.mockResolvedValue(new Response("{bad"));
    if (fault === "duplicate")
      f.transport.mockResolvedValue(Response.json({ error: { code: 4005 } }));
    if (fault === "pending") f.data.status = "PENDING";
    if (fault === "wrong_reference") f.data.clientReference = "another-attempt";
    if (fault === "missing_reference") f.data.clientReference = "";
    const result = await createNuiteeTransactionAdapter(f.options).execute(f.request);
    expect(result.status).toBe("unknown");
    expect(JSON.stringify(result)).not.toContain("private-supplier-canary");
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it.each(["price", "currency", "property", "room", "party", "policy", "relocation"] as const)(
    "retains a correlated confirmation reference but does not invent exact terms after changed %s",
    async (change) => {
      const f = fixture();
      if (change === "price") f.data.price = 90;
      if (change === "currency") f.data.currency = "USD";
      if (change === "property") f.data.hotel.hotelId = "another-hotel";
      if (change === "room") f.data.bookedRooms[0].roomType.roomTypeId = "another-room";
      if (change === "party") f.data.bookedRooms[0].adults = 1;
      if (change === "policy")
        f.data.cancellationPolicies = { refundableTag: "NRFN", cancelPolicyInfos: [] };
      const data =
        change === "relocation"
          ? { ...f.data, bookout: { fromHotelId: "recorded-property", hotelId: "another-hotel" } }
          : f.data;
      f.transport.mockResolvedValue(Response.json({ data }));
      await expect(
        createNuiteeTransactionAdapter(f.options).execute(f.request),
      ).resolves.toMatchObject({
        status: "confirmed",
        providerReference: "synthetic-booking",
        confirmedTerms: null,
      });
    },
  );

  it("reconciles the original booking after consent expiry without booking/payment access", async () => {
    const f = fixture();
    const adapter = createNuiteeTransactionAdapter({
      ...f.options,
      approval: {
        environment: "sandbox",
        statusEvidenceRef: "synthetic-status-approval",
        paymentMethods: [],
      },
      resolveBooking: undefined,
      now: () => new Date("2031-01-01T00:00:00Z"),
    });
    expect(adapter.capabilities.book).toBe(false);
    expect(adapter.capabilities.status).toBe(true);
    await expect(adapter.getStatus!(f.request.idempotencyKey, f.context)).resolves.toMatchObject({
      status: "confirmed",
      confirmedTerms: f.request.terms,
    });
    expect(f.transport.mock.calls[0][0]).toBe(
      "https://book.liteapi.travel/v3.0/bookings/synthetic-booking",
    );
    expect(f.transport.mock.calls[0][1]).toMatchObject({ method: "GET", body: undefined });
    expect(f.resolveBooking).not.toHaveBeenCalled();
  });

  it("preserves authenticated confirmation truth when original private terms cannot be reconstructed", async () => {
    const f = fixture();
    const adapter = createNuiteeTransactionAdapter({ ...f.options, resolveStatus: undefined });
    await expect(adapter.getStatus!(f.request.idempotencyKey, f.context)).resolves.toMatchObject({
      status: "confirmed",
      providerReference: "synthetic-booking",
      confirmedTerms: null,
    });
  });

  it("does not let a prerequisite resolver mutate the immutable booking identity", async () => {
    const f = fixture();
    const original = structuredClone(f.request);
    f.resolveBooking.mockImplementation(async (input) => {
      input.idempotencyKey = "another-attempt";
      input.terms.finalCustomerMinor = 1;
      return f.privateInput;
    });
    await expect(
      createNuiteeTransactionAdapter(f.options).execute(f.request),
    ).resolves.toMatchObject({
      status: "confirmed",
      confirmedTerms: original.terms,
    });
    expect(f.request).toEqual(original);
  });

  it("does not lose authenticated truth if the terms reader mutates its status context", async () => {
    const f = fixture();
    const adapter = createNuiteeTransactionAdapter({
      ...f.options,
      resolveStatus: async (_key, context) => {
        context.providerReference = "another-booking";
        return f.options.resolveStatus();
      },
    });
    await expect(adapter.getStatus!(f.request.idempotencyKey, f.context)).resolves.toMatchObject({
      status: "confirmed",
      providerReference: "synthetic-booking",
      confirmedTerms: f.request.terms,
    });
    expect(f.context.providerReference).toBe("synthetic-booking");
  });

  it("accepts a selling amount only when the approved private quote contains that exact amount", async () => {
    const f = fixture();
    const input = {
      ...f.privateInput,
      confirmation: { ...f.privateInput.confirmation, sellingPriceMinor: 15000 },
    };
    f.resolveBooking.mockResolvedValue(input);
    f.transport.mockResolvedValue(Response.json({ data: { ...f.data, sellingPrice: "150.00" } }));
    await expect(
      createNuiteeTransactionAdapter(f.options).execute(f.request),
    ).resolves.toMatchObject({
      status: "confirmed",
      confirmedTerms: f.request.terms,
    });
  });

  it("uses a trusted transaction ID without inventing the undocumented TRANSACTION payment enum", async () => {
    const f = fixture();
    const input = {
      ...f.privateInput,
      payload: {
        ...f.privateInput.payload,
        payment: { method: "TRANSACTION_ID", transactionId: "synthetic-transaction" },
      },
    };
    f.resolveBooking.mockResolvedValue(input);
    const adapter = createNuiteeTransactionAdapter({
      ...f.options,
      approval: { ...f.options.approval, paymentMethods: ["TRANSACTION_ID"] },
    });
    await expect(adapter.execute(f.request)).resolves.toMatchObject({ status: "confirmed" });
    expect(JSON.parse(String(f.transport.mock.calls[0][1]!.body)).payment).toEqual(
      input.payload.payment,
    );
  });

  it.each([null, "", "../unapproved", "https://unapproved.invalid", "synthetic-booking?x=1"])(
    "requires an actual safe booking ID for status, not a prebook or a guessed reference: %s",
    async (providerReference) => {
      const f = fixture();
      const adapter = createNuiteeTransactionAdapter(f.options);
      const result = await adapter.getStatus!(f.request.idempotencyKey, {
        ...f.context,
        providerReference,
      });
      expect(result.status).toBe("action_required");
      expect(f.transport).not.toHaveBeenCalled();
    },
  );

  it("never promotes cancellation into proof that no original booking committed", async () => {
    const f = fixture();
    f.data.status = "CANCELED";
    const result = await createNuiteeTransactionAdapter(f.options).getStatus!(
      f.request.idempotencyKey,
      f.context,
    );
    expect(result.status).toBe("action_required");
  });

  it("does not accept another booking's authenticated status", async () => {
    const f = fixture();
    f.data.bookingId = "another-booking";
    const result = await createNuiteeTransactionAdapter(f.options).getStatus!(
      f.request.idempotencyKey,
      f.context,
    );
    expect(result.status).toBe("unknown");
  });

  it.each(["environment", "sandbox_key", "status_approval"] as const)(
    "does not derive access from a key or an approval in the wrong scope: %s",
    async (missing) => {
      const f = fixture();
      const adapter = createNuiteeTransactionAdapter({
        ...f.options,
        ...(missing === "environment"
          ? { approval: { ...f.options.approval, environment: "production" as const } }
          : {}),
        ...(missing === "sandbox_key"
          ? {
              environment: "production" as const,
              approval: { ...f.options.approval, environment: "production" as const },
            }
          : {}),
        ...(missing === "status_approval"
          ? { approval: { ...f.options.approval, statusEvidenceRef: undefined } }
          : {}),
      });
      expect(adapter.capabilities.status).toBe(false);
      expect((await adapter.getStatus!(f.request.idempotencyKey, f.context)).status).toBe(
        "action_required",
      );
      expect(f.transport).not.toHaveBeenCalled();
    },
  );

  it("leaves a timed-out possible commit unresolved instead of retrying or guessing a booking ID", async () => {
    const f = fixture();
    let writes = 0;
    f.transport.mockImplementation(async () => {
      writes++;
      return new Promise<Response>(() => {});
    });
    const adapter = createNuiteeTransactionAdapter({ ...f.options, timeoutMs: 10 });
    const result = await adapter.execute(f.request);
    expect(result.status).toBe("unknown");
    expect(writes).toBe(1);
    expect(
      (
        await adapter.getStatus!(f.request.idempotencyKey, {
          ...f.context,
          providerReference: null,
        })
      ).status,
    ).toBe("action_required");
    expect(writes).toBe(1);
  });

  it("bounds an unresponsive trusted source without sending private information or provider writes", async () => {
    const f = fixture();
    const adapter = createNuiteeTransactionAdapter({
      ...f.options,
      timeoutMs: 10,
      resolveBooking: async () => new Promise<never>(() => {}),
    });
    await expect(adapter.execute(f.request)).rejects.toMatchObject({
      code: "booking_prerequisites_unavailable",
    });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("sanitizes source errors and still preserves an authenticated status confirmation", async () => {
    const f = fixture();
    const adapter = createNuiteeTransactionAdapter({
      ...f.options,
      resolveBooking: async () => {
        throw new Error("holder@example.invalid private-supplier-canary");
      },
      resolveStatus: async () => {
        throw new Error("holder@example.invalid private-supplier-canary");
      },
    });
    await expect(adapter.execute(f.request)).rejects.toMatchObject({
      code: "booking_prerequisites_unavailable",
    });
    expect(f.transport).not.toHaveBeenCalled();
    const result = await adapter.getStatus!(f.request.idempotencyKey, f.context);
    expect(result).toMatchObject({
      status: "confirmed",
      providerReference: "synthetic-booking",
      confirmedTerms: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/holder@example|private-supplier-canary/);
  });

  it("rechecks expiry after resolving private prerequisites", async () => {
    const f = fixture();
    let now = new Date("2029-11-01T00:00:00Z");
    f.options.resolveBooking.mockImplementation(async () => {
      now = new Date("2031-01-01T00:00:00Z");
      return f.privateInput;
    });
    const adapter = createNuiteeTransactionAdapter({ ...f.options, now: () => now });
    await expect(adapter.execute(f.request)).rejects.toMatchObject({
      code: "booking_prerequisites_unavailable",
    });
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(["-1", "80.001", "9007199254740992", "80.00000000000000001"])(
    "retains a real confirmation reference instead of rounding invalid price %s into consent",
    async (price) => {
      const f = fixture();
      const data = { ...f.data, price: "numeric-placeholder" };
      f.transport.mockResolvedValue(
        new Response(JSON.stringify({ data }).replace('"numeric-placeholder"', price)),
      );
      await expect(
        createNuiteeTransactionAdapter(f.options).execute(f.request),
      ).resolves.toMatchObject({
        status: "confirmed",
        providerReference: "synthetic-booking",
        confirmedTerms: null,
      });
    },
  );

  it("compares money in the original decimal representation, not a rounded float", async () => {
    const f = fixture();
    f.privateInput.confirmation.providerTotalMinor = 29;
    const data = { ...f.data, price: "numeric-placeholder" };
    f.transport.mockResolvedValue(
      new Response(JSON.stringify({ data }).replace('"numeric-placeholder"', "0.29")),
    );
    await expect(
      createNuiteeTransactionAdapter(f.options).execute(f.request),
    ).resolves.toMatchObject({
      status: "confirmed",
      confirmedTerms: f.request.terms,
    });
  });

  it.each([
    { sellingPrice: "120.00" },
    { addonsTotalAmount: 20 },
    { addon: { amount: 20, currency: "GBP" } },
    { bookedRooms: [] },
  ])(
    "does not silently accept additional or incomplete pricing/service facts: %j",
    async (change) => {
      const f = fixture();
      f.transport.mockResolvedValue(Response.json({ data: { ...f.data, ...change } }));
      await expect(
        createNuiteeTransactionAdapter(f.options).execute(f.request),
      ).resolves.toMatchObject({
        status: "confirmed",
        providerReference: "synthetic-booking",
        confirmedTerms: null,
      });
    },
  );
});
