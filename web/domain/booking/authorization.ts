import { createHash } from "node:crypto";
import { z } from "zod";

const uuid = z.uuid();
const utcDateTime = z.iso.datetime({ offset: true });

export const bookingTermsSchema = z.object({
  departureOrigin: z.object({
    kind: z.enum(["city", "airport"]), placeId: z.string().min(1).max(256),
    name: z.string().min(1).max(120), countryCode: z.string().regex(/^[A-Z]{2}$/),
    timezone: z.string().min(1), airportCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  }).strict(),
  travellerParty: z.object({ adults: z.number().int().min(1).max(10),
    children: z.array(z.object({ id: uuid, ageAtTripStart: z.number().int().min(0).max(17) }).strict()) }).strict(),
  components: z.array(z.object({
    componentId: uuid, supplierOfferId: z.string().min(1).max(256), inventoryId: z.string().min(1).max(256),
    serviceStart: utcDateTime, serviceEnd: utcDateTime, travellerIds: z.array(uuid).min(1).max(10),
    finalCustomerMinor: z.number().int().nonnegative(), taxesMinor: z.number().int().nonnegative().default(0),
    feesMinor: z.number().int().nonnegative().default(0), currency: z.string().regex(/^[A-Z]{3}$/),
    cancellationTerms: z.string().min(1).max(4000), expiresAt: utcDateTime,
    nonReversible: z.boolean().default(false),
  }).strict()).min(1).max(32),
  totalPrice: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), minorUnits: z.number().int().nonnegative() }).strict(),
  nonReversibleActions: z.array(uuid).max(32),
}).strict().superRefine((terms, context) => {
  const ids = terms.components.map((component) => component.componentId);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["components"], message: "Component IDs must be unique" });
  if (terms.components.some((component) => component.currency !== terms.totalPrice.currency)) {
    context.addIssue({ code: "custom", path: ["components"], message: "All live components must use the trip presentation currency" });
  }
  const componentTotal = terms.components.reduce((sum, component) => sum + component.finalCustomerMinor, 0);
  if (!Number.isSafeInteger(componentTotal) || componentTotal !== terms.totalPrice.minorUnits) {
    context.addIssue({ code: "custom", path: ["totalPrice", "minorUnits"], message: "Live total must equal component totals" });
  }
  const nonReversibleIds = terms.components.filter((component) => component.nonReversible).map((component) => component.componentId).sort();
  if (canonicalSet(nonReversibleIds) !== canonicalSet([...terms.nonReversibleActions].sort())) {
    context.addIssue({ code: "custom", path: ["nonReversibleActions"], message: "Non-reversible actions must match component terms" });
  }
});

function canonicalSet(values: string[]): string { return JSON.stringify(values); }

export type BookingTerms = z.infer<typeof bookingTermsSchema>;
export type PublicBookingTerms = Omit<BookingTerms, "components"> & {
  components: Array<Omit<BookingTerms["components"][number], "supplierOfferId" | "inventoryId" | "nonReversible">>;
};
export type BookingOperation = "book_trip" | "reschedule_component" | "cancel_component";
export type AuthorizationStatus = "pending" | "authorized" | "invalidated" | "expired" | "consumed";

export interface BookingAuthorization {
  id: string;
  tripId: string;
  userId: string;
  tripVersion: number;
  operation: BookingOperation;
  componentId: string | null;
  terms: BookingTerms;
  termsHash: string;
  acknowledgedNonReversibleActions: string[];
  status: AuthorizationStatus;
  reason: string | null;
  authorizedAt: string;
  expiresAt: string;
}

export function canonicalBookingJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalBookingJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalBookingJson(object[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Booking terms must be JSON serializable");
  return serialized;
}

export function hashBookingTerms(terms: BookingTerms): string {
  return createHash("sha256").update(canonicalBookingJson(bookingTermsSchema.parse(terms))).digest("hex");
}

export function projectBookingTerms(terms: BookingTerms): PublicBookingTerms {
  const { components, ...summary } = terms;
  return { ...summary, components: components.map((component) => ({
    componentId: component.componentId, serviceStart: component.serviceStart, serviceEnd: component.serviceEnd,
    travellerIds: component.travellerIds, finalCustomerMinor: component.finalCustomerMinor,
    taxesMinor: component.taxesMinor, feesMinor: component.feesMinor, currency: component.currency,
    cancellationTerms: component.cancellationTerms, expiresAt: component.expiresAt,
  })) };
}

export function assertAuthorizationTerms(input: {
  authorization: BookingAuthorization;
  ownerUserId: string;
  tripVersion: number;
  operation: BookingOperation;
  componentId: string | null;
  now?: Date;
}): void {
  const { authorization, ownerUserId, tripVersion, operation, componentId, now = new Date() } = input;
  if (authorization.userId !== ownerUserId || authorization.tripVersion !== tripVersion
    || authorization.operation !== operation || authorization.componentId !== componentId) {
    throw new Error("Booking authorization does not match the current trip and operation");
  }
  if (authorization.status !== "authorized") throw new Error(`Booking authorization is ${authorization.status}`);
  if (Date.parse(authorization.expiresAt) <= now.getTime()) throw new Error("Booking authorization has expired");
  if (hashBookingTerms(authorization.terms) !== authorization.termsHash) throw new Error("Booking terms hash is invalid");
}
