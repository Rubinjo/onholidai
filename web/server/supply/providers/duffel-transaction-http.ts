import "server-only";
import { createHash } from "node:crypto";

import { z } from "zod";

import {
  bookingComponentTermsSchema,
  bookingTermsV2ComponentSchema,
  canonicalBookingJson,
} from "@/domain/booking/authorization";
import { qualifiedInstant } from "@/domain/trip/feasibility-policy";
import { ProblemError } from "@/server/errors";
import { boundedTrustedRead } from "@/server/supply/payment";
import { SupplyReadError } from "@/server/supply/read";
import { providerRequestFingerprint } from "@/server/supply/transactions";

import { decimalMinor, instant, readJson, secret, type ReadHttpOptions } from "./read-http";

import type {
  ProviderStatusContext,
  ProviderTransactionClient,
  ProviderWriteRequest,
} from "@/server/supply/transactions";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const orderId = z.string().regex(/^ord_[A-Za-z0-9]{1,120}$/);
const offerId = z.string().regex(/^off_[A-Za-z0-9]{1,120}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const attemptKey = z.string().min(1).max(2048);
const currency = z.string().regex(/^[A-Z]{3}$/);
const amount = z.number().int().nonnegative().safe();
const timestamp = z.iso.datetime({ offset: true });
const policy = z.record(z.string(), z.unknown());
const paymentMethod = z.enum(["balance", "arc_bsp_cash"]);
const identitySchema = z.object({
  given_name: z.string().min(1).max(40),
  family_name: z.string().min(1).max(40),
  born_on: z.iso.date(),
  gender: z.enum(["m", "f"]),
  title: z.enum(["mr", "ms", "mrs", "miss", "dr"]),
  email: z.email().max(254),
  phone_number: z.string().min(1).max(40),
});
const passportSchema = z
  .object({
    type: z.literal("passport"),
    expires_on: z.iso.date(),
    issuing_country_code: z.string().regex(/^[A-Z]{2}$/),
    unique_identifier: z.string().min(1).max(120),
  })
  .strict();
const passengerSchema = identitySchema
  .extend({
    id: identifier,
    identity_documents: z.array(passportSchema).max(1).optional(),
    infant_passenger_id: identifier.optional(),
  })
  .strict();
const baggageSchema = z.object({
  type: z.enum(["carry_on", "checked"]),
  quantity: z.number().int().min(0).max(32),
});
const fareSchema = z.object({
  passengerId: identifier,
  cabinClass: z.string().min(1).max(64).nullable(),
  cabinName: z.string().min(1).max(120).nullable(),
  baggages: z.array(baggageSchema).max(16),
  seat: policy.nullable(),
});
const segmentSchema = z.object({
  departingAt: timestamp,
  arrivingAt: timestamp,
  originAirport: z.string().regex(/^[A-Z]{3}$/),
  destinationAirport: z.string().regex(/^[A-Z]{3}$/),
  operatingCarrierId: identifier,
  operatingCarrierName: z.string().min(1).max(240),
  marketingCarrierId: identifier,
  marketingFlightNumber: z.string().min(1).max(16),
  passengers: z.array(fareSchema).min(1).max(9),
});
const confirmationSchema = z
  .object({
    offerId,
    liveMode: z.boolean(),
    currency,
    providerTotalMinor: amount,
    providerBaseMinor: amount,
    providerTaxMinor: amount,
    conditions: policy,
    slices: z
      .array(
        z.object({
          conditions: policy,
          fareBrand: z.string().min(1).max(240).nullable(),
          segments: z.array(segmentSchema).min(1).max(16),
        }),
      )
      .min(1)
      .max(8),
    passengers: z
      .array(
        z.object({
          id: identifier,
          type: z.string().min(1).max(40),
          identityFingerprint: hash,
        }),
      )
      .min(1)
      .max(9),
  })
  .strict();
const basisSchema = z
  .object({
    idempotencyKey: attemptKey,
    requestFingerprint: hash,
    supplierOfferId: offerId,
    inventoryId: z.string().min(1).max(256),
    travellerPassengers: z
      .array(z.object({ travellerId: z.uuid(), passengerId: identifier }).strict())
      .min(1)
      .max(9),
    confirmation: confirmationSchema,
  })
  .strict();
const bookingInputSchema = basisSchema
  .extend({
    identityDocumentsRequired: z.boolean(),
    payload: z
      .object({
        passengers: z.array(passengerSchema).min(1).max(9),
        payment: z
          .object({
            type: paymentMethod,
            amount: z.string().regex(/^\d{1,16}(?:\.\d{1,8})?$/),
            currency,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
type Terms = ProviderWriteRequest["terms"];
type Basis = z.infer<typeof basisSchema>;
type Confirmation = z.infer<typeof confirmationSchema>;
export type DuffelBookingInput = z.infer<typeof bookingInputSchema>;
export type DuffelConfirmationBasis = Basis;

export interface DuffelTransactionHttpOptions extends ReadHttpOptions {
  writeToken: string;
  environment: "sandbox" | "production";
  approval?: {
    environment: "sandbox" | "production";
    bookingEvidenceRef?: string;
    statusEvidenceRef?: string;
    finalTermsEvidenceRef?: string;
    paymentMethods: readonly z.infer<typeof paymentMethod>[];
  };
  resolveBooking?: (request: ProviderWriteRequest, signal: AbortSignal) => Promise<unknown>;
  resolveStatus?: (
    key: string,
    context: ProviderStatusContext,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

function blocked(): ProblemError {
  return new ProblemError({
    title: "Trusted Duffel booking prerequisites are unavailable",
    status: 409,
    code: "booking_prerequisites_unavailable",
    detail:
      "Flight booking requires approved environment access, exact terms and trusted identity/payment evidence.",
  });
}

export function duffelPassengerIdentityFingerprint(value: unknown): string {
  const parsed = identitySchema.safeParse(value);
  if (!parsed.success) throw blocked();
  return createHash("sha256").update(canonicalBookingJson(parsed.data)).digest("hex");
}

function matchesBasis(basis: Basis, terms: Terms, key: string): boolean {
  const selected = basis.confirmation;
  const segments = selected.slices.flatMap((slice) => slice.segments);
  const sameSet = (a: string[], b: string[]) =>
    canonicalBookingJson([...a].sort()) === canonicalBookingJson([...b].sort());
  const passengerIds = basis.travellerPassengers.map((entry) => entry.passengerId);
  return (
    basis.idempotencyKey === key &&
    basis.requestFingerprint === providerRequestFingerprint({ operation: "book_trip", terms }) &&
    basis.supplierOfferId === terms.supplierOfferId &&
    selected.offerId === terms.supplierOfferId &&
    basis.inventoryId === terms.inventoryId &&
    selected.currency === terms.currency &&
    selected.providerBaseMinor + selected.providerTaxMinor === selected.providerTotalMinor &&
    Number.isSafeInteger(selected.providerTotalMinor) &&
    new Set(passengerIds).size === passengerIds.length &&
    new Set(basis.travellerPassengers.map((entry) => entry.travellerId)).size ===
      basis.travellerPassengers.length &&
    sameSet(
      basis.travellerPassengers.map((entry) => entry.travellerId),
      terms.travellerIds,
    ) &&
    sameSet(
      selected.passengers.map((entry) => entry.id),
      passengerIds,
    ) &&
    segments.every((segment) =>
      sameSet(
        segment.passengers.map((entry) => entry.passengerId),
        passengerIds,
      ),
    ) &&
    Date.parse(segments[0].departingAt) === Date.parse(terms.serviceStart) &&
    Date.parse(segments.at(-1)!.arrivingAt) === Date.parse(terms.serviceEnd)
  );
}

function actualConfirmation(data: Record<string, unknown>): Confirmation | null {
  const airportSchema = z.object({
    iata_code: z.string().regex(/^[A-Z]{3}$/),
    time_zone: z.string().min(1).max(120),
  });
  const raw = z
    .object({
      offer_id: offerId,
      live_mode: z.boolean(),
      booking_reference: z.string().min(1).max(256),
      payment_status: z.object({ awaiting_payment: z.literal(false), paid_at: timestamp }),
      cancellation: z.null(),
      cancelled_at: z.null(),
      changes: z.array(z.unknown()).max(0),
      airline_initiated_changes: z.array(z.unknown()).max(0),
      services: z.array(z.unknown()).max(0),
      total_amount: z.string(),
      total_currency: currency,
      base_amount: z.string(),
      base_currency: currency,
      tax_amount: z.string(),
      tax_currency: currency,
      conditions: policy,
      passengers: z
        .array(identitySchema.extend({ id: identifier, type: z.string() }))
        .min(1)
        .max(9),
      slices: z
        .array(
          z.object({
            conditions: policy,
            fare_brand_name: z.string().nullable(),
            segments: z
              .array(
                z.object({
                  departing_at: z.string(),
                  arriving_at: z.string(),
                  origin: airportSchema,
                  destination: airportSchema,
                  operating_carrier: z.object({ id: identifier, name: z.string() }),
                  marketing_carrier: z.object({ id: identifier }),
                  marketing_carrier_flight_number: z.string(),
                  passengers: z
                    .array(
                      z.object({
                        passenger_id: identifier,
                        cabin_class: z.string().nullable(),
                        cabin_class_marketing_name: z.string().nullable(),
                        baggages: z.array(baggageSchema).max(16),
                        seat: policy.nullable(),
                      }),
                    )
                    .min(1)
                    .max(9),
                }),
              )
              .min(1)
              .max(16),
          }),
        )
        .min(1)
        .max(8),
    })
    .safeParse(data);
  if (!raw.success) return null;
  const value = raw.data;
  if (value.base_currency !== value.total_currency || value.tax_currency !== value.total_currency)
    return null;
  const serviceInstant = (local: string, timezone: string) => {
    const explicit = instant(local);
    if (explicit) return explicit;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d$/.test(local)) return null;
    const parsed = qualifiedInstant(local, timezone);
    return parsed === null ? null : new Date(parsed).toISOString();
  };
  const normalized = confirmationSchema.safeParse({
    offerId: value.offer_id,
    liveMode: value.live_mode,
    currency: value.total_currency,
    providerTotalMinor: decimalMinor(value.total_amount, value.total_currency),
    providerBaseMinor: decimalMinor(value.base_amount, value.base_currency),
    providerTaxMinor: decimalMinor(value.tax_amount, value.tax_currency),
    conditions: value.conditions,
    passengers: value.passengers.map((passenger) => ({
      id: passenger.id,
      type: passenger.type,
      identityFingerprint: duffelPassengerIdentityFingerprint(passenger),
    })),
    slices: value.slices.map((slice) => ({
      conditions: slice.conditions,
      fareBrand: slice.fare_brand_name,
      segments: slice.segments.map((segment) => ({
        departingAt: serviceInstant(segment.departing_at, segment.origin.time_zone),
        arrivingAt: serviceInstant(segment.arriving_at, segment.destination.time_zone),
        originAirport: segment.origin.iata_code,
        destinationAirport: segment.destination.iata_code,
        operatingCarrierId: segment.operating_carrier.id,
        operatingCarrierName: segment.operating_carrier.name,
        marketingCarrierId: segment.marketing_carrier.id,
        marketingFlightNumber: segment.marketing_carrier_flight_number,
        passengers: segment.passengers.map((passenger) => ({
          passengerId: passenger.passenger_id,
          cabinClass: passenger.cabin_class,
          cabinName: passenger.cabin_class_marketing_name,
          baggages: passenger.baggages,
          seat: passenger.seat,
        })),
      })),
    })),
  });
  return normalized.success ? normalized.data : null;
}

// Only instant Orders and saved-order reads; never holds, separate payments or changes.
// https://duffel.com/docs/api/v2/orders/create-order
// https://duffel.com/docs/api/v2/orders/get-order-by-id
export function createDuffelTransactionHttpClient(
  options: DuffelTransactionHttpOptions,
): ProviderTransactionClient {
  const token = secret(options.writeToken);
  const environmentMatches =
    (options.environment === "sandbox" && token.startsWith("duffel_test_")) ||
    (options.environment === "production" && token.startsWith("duffel_live_"));
  const approved = environmentMatches && options.approval?.environment === options.environment;
  const evidence = (value: string | undefined) => Boolean(value?.trim() && value.length <= 256);
  const methods = paymentMethod.array().max(2).safeParse(options.approval?.paymentMethods);
  const book = Boolean(
    approved &&
    evidence(options.approval?.bookingEvidenceRef) &&
    evidence(options.approval?.finalTermsEvidenceRef) &&
    methods.success &&
    methods.data.length &&
    options.resolveBooking,
  );
  const status = approved && evidence(options.approval?.statusEvidenceRef);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Duffel-Version": "v2",
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const now = () => (options.now?.() ?? new Date()).getTime();
  const signal = () => AbortSignal.timeout(Math.min(8000, Math.max(1, options.timeoutMs ?? 8000)));
  const metadata = (key: string, terms: Terms) => ({
    onholidai_attempt: createHash("sha256").update(key).digest("hex"),
    onholidai_fingerprint: providerRequestFingerprint({ operation: "book_trip", terms }),
  });
  async function request(url: string, method: "GET" | "POST", abort: AbortSignal, body?: unknown) {
    try {
      return await readJson(options, [`${method} ${url}`], headers)(url, method, abort, body);
    } catch (error) {
      if (!(error instanceof SupplyReadError)) throw error;
      return null;
    }
  }
  function outcome(
    raw: unknown,
    key: string,
    terms: Terms,
    basis: Basis | null,
    savedReference?: string,
  ): unknown {
    const envelope = z.object({ data: z.object({ id: orderId }).passthrough() }).safeParse(raw);
    if (!envelope.success) return { status: "unknown" };
    const data = envelope.data.data;
    if (savedReference !== undefined) {
      if (data.id !== savedReference) return { status: "unknown" };
    } else {
      const expected = metadata(key, terms);
      const correlation = z
        .object({
          onholidai_attempt: z.literal(expected.onholidai_attempt),
          onholidai_fingerprint: z.literal(expected.onholidai_fingerprint),
        })
        .safeParse(data.metadata);
      if (!correlation.success) return { status: "unknown" };
    }
    let confirmation: Confirmation | null;
    try {
      confirmation = actualConfirmation(data);
    } catch (error) {
      if (!(error instanceof SupplyReadError)) throw error;
      confirmation = null;
    }
    const exact =
      confirmation &&
      basis &&
      matchesBasis(basis, terms, key) &&
      confirmation.liveMode === (options.environment === "production") &&
      canonicalBookingJson(confirmation) === canonicalBookingJson(basis.confirmation);
    return {
      status: "confirmed",
      providerReference: data.id,
      confirmedTerms: exact ? terms : null,
      evidenceId: createHash("sha256")
        .update(canonicalBookingJson({ orderId: data.id, confirmation }))
        .digest("hex"),
    };
  }
  return {
    capabilities: {
      book,
      status,
      cancel: false,
      reschedule: false,
      idempotency: false,
      revalidation: "unsupported",
    },
    async execute(input) {
      const { idempotencyKey } = input;
      const parsed = bookingTermsV2ComponentSchema.safeParse(input.terms);
      if (
        !book ||
        !options.resolveBooking ||
        !attemptKey.safeParse(idempotencyKey).success ||
        input.operation !== "book_trip" ||
        !parsed.success ||
        parsed.data.provider !== "duffel" ||
        parsed.data.service.type !== "flight" ||
        parsed.data.disposition !== "to_book" ||
        parsed.data.componentId !== input.componentId ||
        parsed.data.inventoryId !== input.inventoryId ||
        parsed.data.supplierOfferId !== input.supplierOfferId ||
        input.requestFingerprint !==
          providerRequestFingerprint({ operation: "book_trip", terms: parsed.data }) ||
        !Number.isFinite(now()) ||
        Date.parse(parsed.data.expiresAt) <= now()
      )
        throw blocked();
      const terms = parsed.data;
      const abort = signal();
      const resolve = options.resolveBooking;
      const trusted = bookingInputSchema.safeParse(
        await boundedTrustedRead(
          () => resolve({ ...input, terms: structuredClone(terms) }, abort),
          abort,
        ),
      );
      if (!trusted.success) throw blocked();
      const { payload, identityDocumentsRequired, ...basis } = trusted.data;
      let paymentMinor: number;
      try {
        paymentMinor = decimalMinor(payload.payment.amount, payload.payment.currency);
      } catch (error) {
        if (!(error instanceof SupplyReadError)) throw error;
        throw blocked();
      }
      const identities = payload.passengers.map((passenger) => ({
        id: passenger.id,
        identityFingerprint: duffelPassengerIdentityFingerprint(passenger),
      }));
      const expectedIdentities = basis.confirmation.passengers.map(
        ({ id, identityFingerprint }) => ({
          id,
          identityFingerprint,
        }),
      );
      if (
        !matchesBasis(basis, terms, idempotencyKey) ||
        basis.confirmation.liveMode !== (options.environment === "production") ||
        !methods.success ||
        !methods.data.includes(payload.payment.type) ||
        payload.payment.currency !== terms.currency ||
        paymentMinor !== basis.confirmation.providerTotalMinor ||
        canonicalBookingJson(identities) !== canonicalBookingJson(expectedIdentities) ||
        payload.passengers.some(
          (passenger) =>
            (identityDocumentsRequired && !passenger.identity_documents?.length) ||
            passenger.identity_documents?.some(
              (document) =>
                Date.parse(document.expires_on) < Date.parse(terms.serviceEnd.slice(0, 10)),
            ) ||
            (passenger.infant_passenger_id !== undefined &&
              (passenger.infant_passenger_id === passenger.id ||
                !identities.some((entry) => entry.id === passenger.infant_passenger_id))),
        ) ||
        !Number.isFinite(now()) ||
        Date.parse(terms.expiresAt) <= now()
      )
        throw blocked();
      return outcome(
        await request("https://api.duffel.com/air/orders", "POST", abort, {
          data: {
            type: "instant",
            selected_offers: [terms.supplierOfferId],
            passengers: payload.passengers,
            payments: [payload.payment],
            metadata: metadata(idempotencyKey, terms),
          },
        }),
        idempotencyKey,
        terms,
        basis,
      );
    },
    async getStatus(key, context) {
      const parsed = bookingComponentTermsSchema.safeParse(context?.terms);
      const reference = orderId.safeParse(context?.providerReference);
      if (
        !status ||
        !context ||
        !attemptKey.safeParse(key).success ||
        !reference.success ||
        !parsed.success ||
        context.componentId !== parsed.data.componentId ||
        ("provider" in parsed.data &&
          (parsed.data.provider !== "duffel" || parsed.data.service.type !== "flight"))
      )
        return { status: "action_required" };
      const abort = signal();
      const raw = await request(
        `https://api.duffel.com/air/orders/${reference.data}`,
        "GET",
        abort,
      );
      let basis: Basis | null = null;
      const resolve = options.resolveStatus;
      if (resolve) {
        try {
          const value = basisSchema.safeParse(
            await boundedTrustedRead(() => resolve(key, structuredClone(context), abort), abort),
          );
          if (value.success) basis = value.data;
        } catch (error) {
          if (
            !(error instanceof ProblemError) ||
            error.code !== "booking_prerequisites_unavailable"
          )
            throw error;
        }
      }
      return outcome(raw, key, parsed.data, basis, reference.data);
    },
  };
}
