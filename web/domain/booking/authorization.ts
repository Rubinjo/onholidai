import { createHash } from "node:crypto";

import { z } from "zod";

import {
  bookingCoverageEvidenceSchema,
  bookingCoverageReportSchema,
  deriveBookingCoverage,
  verifiedBookingDispositionSchema,
} from "@/domain/trip/booking-coverage";
import { publicSupplierText } from "@/lib/privacy";

import { bookingServiceSchema, publicBookingTermsSchema } from "./public";

import type { TripSnapshot } from "@/domain/trip/schema";
import type { PublicBookingTerms } from "./public";

export { bookingServiceSchema, type PublicBookingTerms } from "./public";
const uuid = z.uuid();
const utcDateTime = z.iso.datetime({ offset: true });

export const bookingTermsV1Schema = z
  .object({
    departureOrigin: z
      .object({
        kind: z.enum(["city", "airport"]),
        placeId: z.string().min(1).max(256),
        name: z.string().min(1).max(120),
        countryCode: z.string().regex(/^[A-Z]{2}$/),
        timezone: z.string().min(1),
        airportCode: z
          .string()
          .regex(/^[A-Z]{3}$/)
          .nullable(),
      })
      .strict(),
    travellerParty: z
      .object({
        adults: z.number().int().min(1).max(10),
        children: z.array(
          z.object({ id: uuid, ageAtTripStart: z.number().int().min(0).max(17) }).strict(),
        ),
      })
      .strict(),
    components: z
      .array(
        z
          .object({
            componentId: uuid,
            supplierOfferId: z.string().min(1).max(256),
            inventoryId: z.string().min(1).max(256),
            serviceStart: utcDateTime,
            serviceEnd: utcDateTime,
            travellerIds: z.array(uuid).min(1).max(10),
            finalCustomerMinor: z.number().int().nonnegative(),
            taxesMinor: z.number().int().nonnegative().default(0),
            feesMinor: z.number().int().nonnegative().default(0),
            currency: z.string().regex(/^[A-Z]{3}$/),
            cancellationTerms: z.string().min(1).max(4000),
            expiresAt: utcDateTime,
            nonReversible: z.boolean().default(false),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    totalPrice: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        minorUnits: z.number().int().nonnegative(),
      })
      .strict(),
    nonReversibleActions: z.array(uuid).max(32),
  })
  .strict()
  .superRefine((terms, context) => {
    const ids = terms.components.map((component) => component.componentId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        path: ["components"],
        message: "Component IDs must be unique",
      });
    if (terms.components.some((component) => component.currency !== terms.totalPrice.currency)) {
      context.addIssue({
        code: "custom",
        path: ["components"],
        message: "All live components must use the trip presentation currency",
      });
    }
    const componentTotal = terms.components.reduce(
      (sum, component) => sum + component.finalCustomerMinor,
      0,
    );
    if (!Number.isSafeInteger(componentTotal) || componentTotal !== terms.totalPrice.minorUnits) {
      context.addIssue({
        code: "custom",
        path: ["totalPrice", "minorUnits"],
        message: "Live total must equal component totals",
      });
    }
    const nonReversibleIds = terms.components
      .filter((component) => component.nonReversible)
      .map((component) => component.componentId)
      .sort();
    if (canonicalSet(nonReversibleIds) !== canonicalSet([...terms.nonReversibleActions].sort())) {
      context.addIssue({
        code: "custom",
        path: ["nonReversibleActions"],
        message: "Non-reversible actions must match component terms",
      });
    }
  });

function canonicalSet(values: string[]): string {
  return JSON.stringify(values);
}

export const bookingTermsV2ComponentSchema = bookingTermsV1Schema.shape.components.element
  .extend({
    taxesMinor: z.number().int().nonnegative().safe(),
    feesMinor: z.number().int().nonnegative().safe(),
    nonReversible: z.boolean(),
    provider: z.enum(["duffel", "nuitee", "viator", "booking", "getyourguide", "trainline"]),
    attribution: z
      .object({
        provider: z.string().min(1).max(120),
        sourceUrl: z.url().nullable(),
      })
      .strict(),
    disposition: z.enum(["already_confirmed", "to_book"]),
    confirmationId: z.string().min(1).max(256).nullable(),
    service: bookingServiceSchema,
    evidence: bookingCoverageEvidenceSchema,
  })
  .strict()
  .superRefine((entry, context) => {
    if (Date.parse(entry.serviceEnd) <= Date.parse(entry.serviceStart))
      context.addIssue({
        code: "custom",
        path: ["serviceEnd"],
        message: "Service end must follow its start",
      });
    if (
      entry.disposition === "to_book" &&
      (!entry.service.timezone ||
        !entry.service.refundTerms ||
        !entry.service.changeTerms ||
        !entry.service.taxFeeInclusion ||
        (entry.service.type === "flight" && !entry.service.fare) ||
        (entry.service.type === "accommodation" &&
          (!entry.service.propertyId ||
            !entry.service.propertyType ||
            !entry.service.roomIds.length ||
            !entry.service.occupancy)))
    )
      context.addIssue({
        code: "custom",
        path: ["service"],
        message: "Complete verified final service terms are required",
      });
  });
export const bookingTermsV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    tripVersion: z.number().int().positive(),
    departureOrigin: bookingTermsV1Schema.shape.departureOrigin,
    travellerParty: bookingTermsV1Schema.shape.travellerParty,
    coverage: bookingCoverageReportSchema,
    components: z.array(bookingTermsV2ComponentSchema).min(1).max(32),
    totalPrice: bookingTermsV1Schema.shape.totalPrice,
    nonReversibleActions: z.array(uuid).max(32),
    continuationOf: uuid.nullable(),
    rootAttemptId: uuid.nullable(),
    dispositionEvidence: z.array(verifiedBookingDispositionSchema).max(768).default([]),
  })
  .strict()
  .superRefine((terms, context) => {
    const reject = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });
    const sameIds = (a: string[], b: string[]) =>
      new Set(a).size === a.length && canonicalSet([...a].sort()) === canonicalSet([...b].sort());
    const ids = terms.components.map((entry) => entry.componentId);
    if (new Set(ids).size !== ids.length) reject(["components"], "Component IDs must be unique");
    const toBook = terms.components.filter((entry) => entry.disposition === "to_book");
    const confirmed = terms.components.filter((entry) => entry.disposition === "already_confirmed");
    const coverage = terms.coverage;
    if (
      !coverage.complete ||
      !coverage.eligible ||
      coverage.issues.length ||
      coverage.tripVersion !== terms.tripVersion ||
      !coverage.entries.length ||
      coverage.entries.some(
        (entry) =>
          entry.issues.length ||
          !["eligible_unbooked", "confirmed", "not_required"].includes(entry.state),
      )
    )
      reject(["coverage"], "Complete verified whole-trip coverage is required");
    if (
      !sameIds(
        coverage.toBookComponentIds,
        toBook.map((entry) => entry.componentId),
      ) ||
      !sameIds(
        coverage.confirmedComponentIds,
        confirmed.map((entry) => entry.componentId),
      ) ||
      !sameIds([...new Set(coverage.entries.flatMap((entry) => entry.componentIds))], ids)
    )
      reject(["coverage"], "Coverage must bind the entire exact component set");
    if (
      new Set(coverage.entries.map((entry) => entry.requirementId)).size !== coverage.entries.length
    )
      reject(["coverage", "entries"], "Requirement IDs must be unique");
    const total = toBook.reduce((sum, entry) => sum + entry.finalCustomerMinor, 0);
    if (
      !toBook.length ||
      !Number.isSafeInteger(total) ||
      total !== terms.totalPrice.minorUnits ||
      total !== coverage.remainingPayable.minorUnits ||
      coverage.remainingPayable.currency !== terms.totalPrice.currency
    )
      reject(["totalPrice"], "Remaining payable amount must equal the exact to-book customer sum");
    const nonReversible = toBook
      .filter((entry) => entry.nonReversible)
      .map((entry) => entry.componentId);
    if (!sameIds(terms.nonReversibleActions, nonReversible))
      reject(
        ["nonReversibleActions"],
        "Acknowledgements must match the exact to-book non-reversible set",
      );
    if ((terms.continuationOf === null) !== (terms.rootAttemptId === null))
      reject(["continuationOf"], "Recovery lineage must have both parent and root");
    const products: Record<string, string> = {
      flight: "duffel",
      accommodation: "nuitee",
      activity: "viator",
    };
    terms.components.forEach((entry, index) => {
      const proof = entry.evidence;
      const path = ["components", index];
      if (
        (entry.disposition === "to_book" && entry.currency !== terms.totalPrice.currency) ||
        !Number.isSafeInteger(entry.finalCustomerMinor) ||
        !Number.isSafeInteger(entry.taxesMinor + entry.feesMinor) ||
        entry.taxesMinor + entry.feesMinor > entry.finalCustomerMinor
      )
        reject(path, "Customer currency and exact included taxes and fees must be consistent");
      if (
        proof.componentId !== entry.componentId ||
        proof.provider !== entry.provider ||
        proof.supplierOfferId !== entry.supplierOfferId ||
        proof.inventoryId !== entry.inventoryId ||
        proof.serviceStart !== entry.serviceStart ||
        proof.serviceEnd !== entry.serviceEnd ||
        !sameIds(proof.travellerIds, entry.travellerIds) ||
        proof.currency !== entry.currency ||
        proof.finalCustomerMinor !== entry.finalCustomerMinor ||
        canonicalBookingJson(proof.occupancy) !== canonicalBookingJson(entry.service.occupancy)
      )
        reject([...path, "evidence"], "Material evidence must match exact component terms");
      const requirementIds = coverage.entries
        .filter((requirement) => requirement.componentIds.includes(entry.componentId))
        .map((requirement) => requirement.requirementId);
      if (!sameIds(proof.requirementIds, requirementIds))
        reject(
          [...path, "evidence", "requirementIds"],
          "Every mapped required service must be bound",
        );
      if (
        entry.disposition === "to_book" &&
        entry.service.type === "accommodation" &&
        (!entry.service.propertyId ||
          !entry.service.propertyType ||
          !entry.service.roomIds.length ||
          !entry.service.occupancy)
      )
        reject([...path, "service"], "Exact property, room and occupancy facts are required");
      if (entry.disposition === "to_book" && entry.service.type === "flight" && !entry.service.fare)
        reject([...path, "service", "fare"], "Exact fare terms are required");
      if (entry.disposition === "already_confirmed") {
        if (!entry.confirmationId || entry.confirmationId !== proof.confirmationId)
          reject([...path, "confirmationId"], "A durable matching commitment is required");
      } else {
        if (
          entry.confirmationId !== null ||
          proof.confirmationId !== null ||
          products[entry.service.type] !== entry.provider ||
          !proof.finalTermsVerified ||
          !proof.taxesFeesKnown ||
          !proof.bookingSupported ||
          proof.availability !== "verified" ||
          proof.eligibility !== "verified" ||
          !entry.service.refundTerms ||
          !entry.service.changeTerms ||
          !entry.service.taxFeeInclusion ||
          !proof.travellerReadiness ||
          !proof.paymentReadiness ||
          proof.expiresAt !== entry.expiresAt
        )
          reject(
            path,
            "New writes require current supported final terms and trusted prerequisites",
          );
      }
    });
  });
export const bookingTermsSchema = z.union([bookingTermsV2Schema, bookingTermsV1Schema]);
export const bookingComponentTermsSchema = z.union([
  bookingTermsV2ComponentSchema,
  bookingTermsV1Schema.shape.components.element,
]);
export type BookingTermsV1 = z.infer<typeof bookingTermsV1Schema>;
export type BookingTermsV2 = z.infer<typeof bookingTermsV2Schema>;
export type BookingTerms = z.infer<typeof bookingTermsSchema>;
export function isWholeTripTerms(terms: BookingTerms): terms is BookingTermsV2 {
  return "schemaVersion" in terms && terms.schemaVersion === 2;
}
export function currentWholeTripCoverage(
  terms: BookingTermsV2,
  snapshot: TripSnapshot,
  tripVersion: number,
  now = new Date(),
) {
  return deriveBookingCoverage(snapshot, {
    tripVersion,
    now,
    evidence: terms.components.map((component) => component.evidence),
    verifiedDispositions: terms.dispositionEvidence,
  });
}
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
    return `{${Object.keys(object)
      .filter((key) => object[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalBookingJson(object[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Booking terms must be JSON serializable");
  return serialized;
}

export function hashBookingTerms(terms: BookingTerms): string {
  return createHash("sha256")
    .update(canonicalBookingJson(bookingTermsSchema.parse(terms)))
    .digest("hex");
}

export function projectBookingTerms(terms: BookingTerms): PublicBookingTerms {
  return publicBookingTermsSchema.parse({
    departureOrigin: {
      ...terms.departureOrigin,
      name: publicSupplierText(terms.departureOrigin.name),
    },
    travellerParty: terms.travellerParty,
    totalPrice: terms.totalPrice,
    nonReversibleActions: terms.nonReversibleActions,
    ...(isWholeTripTerms(terms)
      ? {
          schemaVersion: terms.schemaVersion,
          tripVersion: terms.tripVersion,
          continuationOf: terms.continuationOf,
          rootAttemptId: terms.rootAttemptId,
          coverage: {
            ...terms.coverage,
            issues: terms.coverage.issues.map((issue) => ({
              ...issue,
              message: publicSupplierText(issue.message),
            })),
            entries: terms.coverage.entries.map((entry) => ({
              ...entry,
              sourceRefs: entry.sourceRefs.map(publicSupplierText),
              issues: entry.issues.map((issue) => ({
                ...issue,
                message: publicSupplierText(issue.message),
              })),
            })),
          },
        }
      : {}),
    components: terms.components.map((component) => ({
      componentId: component.componentId,
      serviceStart: component.serviceStart,
      serviceEnd: component.serviceEnd,
      travellerIds: component.travellerIds,
      finalCustomerMinor: component.finalCustomerMinor,
      taxesMinor: component.taxesMinor,
      feesMinor: component.feesMinor,
      currency: component.currency,
      cancellationTerms: publicSupplierText(component.cancellationTerms),
      expiresAt: component.expiresAt,
      ...("service" in component
        ? {
            provider: publicSupplierText(component.provider),
            disposition: component.disposition,
            service: {
              type: component.service.type,
              title: publicSupplierText(component.service.title),
              timezone: component.service.timezone,
              propertyId:
                component.service.propertyId === null
                  ? null
                  : publicSupplierText(component.service.propertyId),
              propertyType:
                component.service.propertyType === null
                  ? null
                  : publicSupplierText(component.service.propertyType),
              roomIds: component.service.roomIds.map(publicSupplierText),
              fare:
                component.service.fare === null ? null : publicSupplierText(component.service.fare),
              baggage: component.service.baggage.map(publicSupplierText),
              refundTerms:
                component.service.refundTerms === null
                  ? null
                  : publicSupplierText(component.service.refundTerms),
              changeTerms:
                component.service.changeTerms === null
                  ? null
                  : publicSupplierText(component.service.changeTerms),
              taxFeeInclusion:
                component.service.taxFeeInclusion === null
                  ? null
                  : publicSupplierText(component.service.taxFeeInclusion),
              occupancy: component.service.occupancy,
            },
            prerequisites: {
              travellers: component.evidence.travellerReadiness
                ? ("ready" as const)
                : ("missing" as const),
              payment: component.evidence.paymentReadiness
                ? ("ready" as const)
                : ("missing" as const),
            },
          }
        : {}),
    })),
  });
}

export function assertAuthorizationTerms(input: {
  authorization: BookingAuthorization;
  ownerUserId: string;
  tripVersion: number;
  operation: BookingOperation;
  componentId: string | null;
  now?: Date;
}): void {
  const {
    authorization,
    ownerUserId,
    tripVersion,
    operation,
    componentId,
    now = new Date(),
  } = input;
  if (
    authorization.userId !== ownerUserId ||
    authorization.tripVersion !== tripVersion ||
    authorization.operation !== operation ||
    authorization.componentId !== componentId
  ) {
    throw new Error("Booking authorization does not match the current trip and operation");
  }
  if (authorization.status !== "authorized")
    throw new Error(`Booking authorization is ${authorization.status}`);
  if (Date.parse(authorization.expiresAt) <= now.getTime())
    throw new Error("Booking authorization has expired");
  if (hashBookingTerms(authorization.terms) !== authorization.termsHash)
    throw new Error("Booking terms hash is invalid");
}
