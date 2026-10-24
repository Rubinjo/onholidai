import "server-only";
import { createHash } from "node:crypto";

import { z } from "zod";

import {
  bookingTermsV2ComponentSchema,
  canonicalBookingJson,
} from "@/domain/booking/authorization";
import { ProblemError } from "@/server/errors";
import { MAX_SUPPLIER_ID_LENGTH } from "@/domain/trip/schema";
import { boundedTrustedRead } from "@/server/supply/payment";
import { SupplyReadError } from "@/server/supply/read";
import { providerRequestFingerprint } from "@/server/supply/transactions";

import { decimalMinor, readJson, secret, type ReadHttpOptions } from "./read-http";

import type {
  ProviderStatusContext,
  ProviderTransactionClient,
  ProviderWriteRequest,
} from "@/server/supply/transactions";

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,256}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const attemptKey = z.string().min(1).max(2048);
const policy = z.record(z.string(), z.unknown());
const name = z.string().trim().min(1).max(120);
const paymentMethod = z.enum(["WALLET", "CREDIT", "ACC_CREDIT_CARD", "TRANSACTION_ID"]);
const payment = z.discriminatedUnion("method", [
  z.object({ method: z.enum(["WALLET", "CREDIT", "ACC_CREDIT_CARD"]) }).strict(),
  z.object({ method: z.literal("TRANSACTION_ID"), transactionId: identifier }).strict(),
]);
const roomSchema = z
  .object({
    roomTypeId: identifier,
    rateId: z.string().min(1).max(MAX_SUPPLIER_ID_LENGTH),
    boardType: z.string().min(1).max(64),
    adults: z.number().int().min(1).max(10),
    childrenAges: z.array(z.number().int().min(0).max(17)).max(10),
    cancellationPolicies: policy,
  })
  .strict();
const confirmationSchema = z
  .object({
    hotelId: identifier,
    checkin: z.iso.date(),
    checkout: z.iso.date(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    providerTotalMinor: z.number().int().nonnegative().safe(),
    sellingPriceMinor: z.number().int().nonnegative().safe().nullable(),
    cancellationPolicies: policy,
    rooms: z.array(roomSchema).min(1).max(10),
  })
  .strict();
const basisSchema = z
  .object({
    requestFingerprint: hash,
    idempotencyKey: attemptKey,
    supplierOfferId: z.string().min(1).max(MAX_SUPPLIER_ID_LENGTH),
    inventoryId: z.string().min(1).max(256),
    confirmation: confirmationSchema,
  })
  .strict();
const bookingInputSchema = basisSchema
  .extend({
    payload: z
      .object({
        prebookId: identifier,
        holder: z
          .object({
            firstName: name,
            lastName: name,
            email: z.email().max(254),
            phone: z.string().min(1).max(40),
          })
          .strict(),
        guests: z
          .array(
            z
              .object({
                occupancyNumber: z.number().int().min(1).max(10),
                firstName: name,
                lastName: name,
                email: z.email().max(254).optional(),
              })
              .strict(),
          )
          .min(1)
          .max(10),
        payment,
      })
      .strict(),
  })
  .strict();
type Terms = z.infer<typeof bookingTermsV2ComponentSchema>;
type Basis = z.infer<typeof basisSchema>;
type Confirmation = z.infer<typeof confirmationSchema>;
export type NuiteeBookingInput = z.infer<typeof bookingInputSchema>;
export type NuiteeConfirmationBasis = Basis;

export interface NuiteeTransactionHttpOptions extends ReadHttpOptions {
  apiKey: string;
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
    title: "Trusted Nuitee booking prerequisites are unavailable",
    status: 409,
    code: "booking_prerequisites_unavailable",
    detail:
      "Booking requires approved environment access, exact final terms and a trusted guest/payment source.",
  });
}

function fingerprint(terms: Terms): string {
  return providerRequestFingerprint({ operation: "book_trip", terms });
}

function localDate(instant: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

function matchesBasis(basis: Basis, terms: Terms, key: string): boolean {
  const selected = basis.confirmation;
  const occupancy = terms.service.occupancy;
  const sameSet = (a: readonly (number | string)[], b: readonly (number | string)[]) =>
    canonicalBookingJson([...a].sort()) === canonicalBookingJson([...b].sort());
  return Boolean(
    terms.provider === "nuitee" &&
    terms.service.type === "accommodation" &&
    terms.service.timezone &&
    occupancy &&
    basis.idempotencyKey === key &&
    basis.requestFingerprint === fingerprint(terms) &&
    basis.supplierOfferId === terms.supplierOfferId &&
    basis.inventoryId === terms.inventoryId &&
    selected.hotelId === terms.service.propertyId &&
    selected.currency === terms.currency &&
    selected.checkin === localDate(terms.serviceStart, terms.service.timezone) &&
    selected.checkout === localDate(terms.serviceEnd, terms.service.timezone) &&
    selected.rooms.length === occupancy.rooms &&
    sameSet(
      selected.rooms.map((room) => room.roomTypeId),
      terms.service.roomIds,
    ) &&
    selected.rooms.reduce((sum, room) => sum + room.adults, 0) === occupancy.adults &&
    sameSet(
      selected.rooms.flatMap((room) => room.childrenAges),
      occupancy.childAges,
    ),
  );
}

function canonicalConditions(value: unknown): string {
  return canonicalBookingJson(
    JSON.parse(JSON.stringify(value), (key: string, entry: unknown) =>
      key === "amount" && typeof entry === "number" ? String(entry) : entry,
    ),
  );
}

function actualConfirmation(data: Record<string, unknown>): Confirmation | null {
  const raw = z
    .object({
      hotel: z.object({ hotelId: identifier }),
      checkin: z.iso.date(),
      checkout: z.iso.date(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      price: z.union([z.string(), z.number()]),
      sellingPrice: z.union([z.string(), z.number()]).nullish(),
      cancellationPolicies: policy,
      bookedRooms: z
        .array(
          z.object({
            roomType: z.object({ roomTypeId: identifier }),
            rate: z.object({
              rateId: z.string().min(1).max(MAX_SUPPLIER_ID_LENGTH),
              boardType: z.string().min(1).max(64),
              cancellationPolicies: policy,
            }),
            adults: z.number().int().min(1).max(10),
            children: z.number().int().min(0).max(10),
            childrenAges: z.array(z.number().int().min(0).max(17)).max(10),
          }),
        )
        .min(1)
        .max(10),
    })
    .safeParse(data);
  if (
    !raw.success ||
    data.bookout !== undefined ||
    data.addon != null ||
    raw.data.bookedRooms.some((room) => room.children !== room.childrenAges.length)
  )
    return null;
  if (
    data.addonsTotalAmount != null &&
    decimalMinor(data.addonsTotalAmount, raw.data.currency) !== 0
  )
    return null;
  return {
    hotelId: raw.data.hotel.hotelId,
    checkin: raw.data.checkin,
    checkout: raw.data.checkout,
    currency: raw.data.currency,
    providerTotalMinor: decimalMinor(raw.data.price, raw.data.currency),
    sellingPriceMinor:
      raw.data.sellingPrice == null ? null : decimalMinor(raw.data.sellingPrice, raw.data.currency),
    cancellationPolicies: raw.data.cancellationPolicies,
    rooms: raw.data.bookedRooms.map((room) => ({
      roomTypeId: room.roomType.roomTypeId,
      rateId: room.rate.rateId,
      boardType: room.rate.boardType,
      adults: room.adults,
      childrenAges: room.childrenAges,
      cancellationPolicies: room.rate.cancellationPolicies,
    })),
  };
}

// These are restricted, approved inputs, not a prebook/read or payment-collection API.
// https://docs.liteapi.travel/reference/post_rates-book.md
// https://docs.liteapi.travel/reference/get_bookings-bookingid.md
export function createNuiteeTransactionHttpClient(
  options: NuiteeTransactionHttpOptions,
): ProviderTransactionClient {
  const key = secret(options.apiKey);
  const approved =
    ["sandbox", "production"].includes(options.environment) &&
    options.approval?.environment === options.environment &&
    (!key.startsWith("sand_") || options.environment === "sandbox");
  const evidenceRef = (value: string | undefined) =>
    Boolean(value && value.trim().length > 0 && value.length <= 256);
  const approvedMethods = paymentMethod.array().max(4).safeParse(options.approval?.paymentMethods);
  const book = Boolean(
    approved &&
    evidenceRef(options.approval?.bookingEvidenceRef) &&
    evidenceRef(options.approval?.finalTermsEvidenceRef) &&
    approvedMethods.success &&
    approvedMethods.data.length &&
    options.resolveBooking,
  );
  const status = approved && evidenceRef(options.approval?.statusEvidenceRef);
  const base = "https://book.liteapi.travel/v3.0";
  const headers = {
    "X-API-Key": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const http = {
    ...options,
    decimalFields: ["price", "amount", "sellingPrice", "addonsTotalAmount"],
  };
  const clientReference = (id: string) =>
    `onholidai-${createHash("sha256").update(id).digest("hex")}`;

  function outcome(
    raw: unknown,
    id: string,
    terms: Terms,
    basis: Basis | null,
    expectedReference?: string,
  ): unknown {
    const parsed = z
      .object({
        data: z
          .object({
            bookingId: identifier,
            clientReference: z.string(),
            status: z.string(),
          })
          .passthrough(),
      })
      .safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.data.clientReference !== clientReference(id) ||
      (expectedReference !== undefined && parsed.data.data.bookingId !== expectedReference)
    )
      return { status: "unknown" };
    const data = parsed.data.data;
    if (data.status === "CANCELED") return { status: "action_required" };
    if (data.status !== "CONFIRMED") return { status: "unknown" };
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
      matchesBasis(basis, terms, id) &&
      canonicalConditions(confirmation) === canonicalConditions(basis.confirmation);
    return {
      status: "confirmed",
      providerReference: data.bookingId,
      confirmedTerms: exact ? terms : null,
      evidenceId: createHash("sha256")
        .update(canonicalBookingJson({ bookingId: data.bookingId, confirmation }))
        .digest("hex"),
    };
  }

  async function request(
    url: string,
    method: "GET" | "POST",
    signal: AbortSignal,
    body?: unknown,
  ): Promise<unknown> {
    try {
      return await readJson(http, [`${method} ${url}`], headers)(url, method, signal, body);
    } catch (error) {
      if (!(error instanceof SupplyReadError)) throw error;
      // Once sent, HTTP failures (including duplicate-reference 4005) do not prove non-commit.
      return null;
    }
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
        parsed.data.disposition !== "to_book" ||
        parsed.data.provider !== "nuitee" ||
        parsed.data.service.type !== "accommodation" ||
        parsed.data.componentId !== input.componentId ||
        parsed.data.supplierOfferId !== input.supplierOfferId ||
        parsed.data.inventoryId !== input.inventoryId ||
        input.requestFingerprint !== fingerprint(parsed.data) ||
        Date.parse(parsed.data.expiresAt) <= (options.now?.() ?? new Date()).getTime()
      )
        throw blocked();
      const terms = parsed.data;
      const signal = AbortSignal.timeout(Math.min(8000, Math.max(1, options.timeoutMs ?? 8000)));
      const resolve = options.resolveBooking;
      const trusted = bookingInputSchema.safeParse(
        await boundedTrustedRead(
          () => resolve({ ...input, terms: structuredClone(terms) }, signal),
          signal,
        ),
      );
      if (!trusted.success) throw blocked();
      const { payload, ...basis } = trusted.data;
      if (
        !matchesBasis(basis, terms, idempotencyKey) ||
        !approvedMethods.success ||
        !approvedMethods.data.includes(payload.payment.method) ||
        payload.guests.length !== basis.confirmation.rooms.length ||
        new Set(payload.guests.map((guest) => guest.occupancyNumber)).size !==
          payload.guests.length ||
        payload.guests.some((guest) => guest.occupancyNumber > basis.confirmation.rooms.length) ||
        Date.parse(terms.expiresAt) <= (options.now?.() ?? new Date()).getTime()
      )
        throw blocked();
      const raw = await request(`${base}/rates/book`, "POST", signal, {
        ...payload,
        clientReference: clientReference(idempotencyKey),
      });
      return outcome(raw, idempotencyKey, terms, basis);
    },
    async getStatus(id, context) {
      if (!status) return { status: "action_required" };
      const parsed = bookingTermsV2ComponentSchema.safeParse(context?.terms);
      const reference = identifier.safeParse(context?.providerReference);
      if (
        !context ||
        !reference.success ||
        !attemptKey.safeParse(id).success ||
        !parsed.success ||
        parsed.data.provider !== "nuitee" ||
        parsed.data.service.type !== "accommodation" ||
        context.componentId !== parsed.data.componentId
      )
        return { status: "action_required" };
      const signal = AbortSignal.timeout(Math.min(8000, Math.max(1, options.timeoutMs ?? 8000)));
      const raw = await request(`${base}/bookings/${reference.data}`, "GET", signal);
      let basis: Basis | null = null;
      const resolve = options.resolveStatus;
      if (resolve) {
        try {
          const value = basisSchema.safeParse(
            await boundedTrustedRead(() => resolve(id, structuredClone(context), signal), signal),
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
      return outcome(raw, id, parsed.data, basis, reference.data);
    },
  };
}
