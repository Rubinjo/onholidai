import { z } from "zod";

import { feasibilityIssueSchema } from "../trip/itinerary.ts";
import { publicSupplierText } from "../../lib/privacy.ts";

const timestamp = z.iso.datetime({ offset: true });
const amount = z.number().int().nonnegative().safe();
const currency = z.string().regex(/^[A-Z]{3}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().min(1).max(4000);
export const BOOKING_COVERAGE_POLICY = "1" as const;
export const bookingOccupancySchema = z
  .object({
    adults: z.number().int().nonnegative().max(10),
    childAges: z.array(z.number().int().min(0).max(17)).max(10),
    rooms: z.number().int().positive().max(10),
  })
  .strict()
  .nullable();
export const bookingCoverageEntrySchema = z
  .object({
    requirementId: z.string().min(1).max(256),
    kind: z.enum(["transport", "accommodation", "activity"]),
    sourceRefs: z.array(z.string().min(1).max(500)).min(1).max(64),
    componentIds: z.array(z.uuid()).max(32),
    state: z.enum([
      "missing",
      "covered_unverified",
      "eligible_unbooked",
      "confirmed",
      "not_required",
      "blocked",
    ]),
    issues: z.array(feasibilityIssueSchema).max(256),
  })
  .strict();
export const bookingCoverageReportSchema = z
  .object({
    policyVersion: z.literal(BOOKING_COVERAGE_POLICY),
    tripVersion: z.number().int().positive(),
    fingerprint: hash,
    entries: z.array(bookingCoverageEntrySchema).max(768),
    issues: z.array(feasibilityIssueSchema).max(1024),
    complete: z.boolean(),
    eligible: z.boolean(),
    toBookComponentIds: z.array(z.uuid()).max(32),
    confirmedComponentIds: z.array(z.uuid()).max(32),
    remainingPayable: z.object({ currency, minorUnits: amount.nullable() }).strict(),
  })
  .strict();
export type BookingCoverageReport = z.infer<typeof bookingCoverageReportSchema>;
export function projectBookingCoverage(report: BookingCoverageReport): BookingCoverageReport {
  const safeIssue = (issue: BookingCoverageReport["issues"][number]) => ({
    ...issue,
    message: publicSupplierText(issue.message),
  });
  return {
    ...report,
    issues: report.issues.map(safeIssue),
    entries: report.entries.map((entry) => ({
      ...entry,
      sourceRefs: entry.sourceRefs.map(publicSupplierText),
      issues: entry.issues.map(safeIssue),
    })),
  };
}
export const bookingServiceSchema = z
  .object({
    type: z.enum(["flight", "accommodation", "activity", "rail", "transfer"]),
    title: text,
    timezone: z
      .string()
      .min(1)
      .max(120)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "An IANA timezone is required")
      .nullable(),
    propertyId: z.string().min(1).max(256).nullable(),
    propertyType: z.string().min(1).max(120).nullable(),
    roomIds: z.array(z.string().min(1).max(256)).max(32),
    fare: text.nullable(),
    baggage: z.array(text).max(16),
    refundTerms: text.nullable(),
    changeTerms: text.nullable(),
    taxFeeInclusion: text.nullable(),
    occupancy: bookingOccupancySchema,
  })
  .strict();
const publicTermComponent = z
  .object({
    componentId: z.uuid(),
    serviceStart: timestamp,
    serviceEnd: timestamp,
    travellerIds: z.array(z.uuid()).min(1).max(10),
    finalCustomerMinor: amount,
    taxesMinor: amount,
    feesMinor: amount,
    currency,
    cancellationTerms: text,
    expiresAt: timestamp,
    provider: z.string().min(1).max(120).optional(),
    disposition: z.enum(["already_confirmed", "to_book"]).optional(),
    service: bookingServiceSchema.optional(),
    prerequisites: z
      .object({
        travellers: z.enum(["ready", "missing"]),
        payment: z.enum(["ready", "missing"]),
      })
      .strict()
      .optional(),
  })
  .strict();
const publicBaseTermsSchema = z
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
          z.object({ id: z.uuid(), ageAtTripStart: z.number().int().min(0).max(17) }).strict(),
        ),
      })
      .strict(),
    components: z.array(publicTermComponent).min(1).max(32),
    totalPrice: z.object({ currency, minorUnits: amount }).strict(),
    nonReversibleActions: z.array(z.uuid()).max(32),
    schemaVersion: z.literal(2).optional(),
    tripVersion: z.number().int().positive().optional(),
    coverage: bookingCoverageReportSchema.optional(),
    continuationOf: z.uuid().nullable().optional(),
    rootAttemptId: z.uuid().nullable().optional(),
  })
  .strict();
export const publicWholeTripTermsSchema = publicBaseTermsSchema.extend({
  schemaVersion: z.literal(2),
  tripVersion: z.number().int().positive(),
  coverage: bookingCoverageReportSchema,
  components: z
    .array(
      publicTermComponent.required({
        provider: true,
        disposition: true,
        service: true,
        prerequisites: true,
      }),
    )
    .min(1)
    .max(32),
  continuationOf: z.uuid().nullable(),
  rootAttemptId: z.uuid().nullable(),
});
export const publicBookingTermsSchema = z.union([
  publicWholeTripTermsSchema,
  publicBaseTermsSchema.extend({
    schemaVersion: z.never().optional(),
    tripVersion: z.never().optional(),
    coverage: z.never().optional(),
    continuationOf: z.never().optional(),
    rootAttemptId: z.never().optional(),
  }),
]);
export type PublicBookingTerms = z.infer<typeof publicBookingTermsSchema>;
export function projectRevalidationOutcomes(raw: unknown) {
  return z
    .array(
      z.object({
        componentId: z.uuid(),
        outcome: z.enum(["unchanged", "changed", "unavailable", "unknown"]),
        safeReason: z.string().max(500).nullish(),
      }),
    )
    .max(32)
    .parse(raw)
    .map(({ componentId, outcome, safeReason }) => ({
      componentId,
      outcome,
      ...(safeReason ? { safeReason: publicSupplierText(safeReason) } : {}),
    }));
}
export const revalidationViewSchema = z
  .object({
    workflowId: z.string().min(1).max(256),
    tripId: z.uuid(),
    tripVersion: z.number().int().positive(),
    status: z.enum(["accepted", "running", "completed", "failed"]),
    outcomes: z
      .array(
        z
          .object({
            componentId: z.uuid(),
            outcome: z.enum(["unchanged", "changed", "unavailable", "unknown"]),
            safeReason: z.string().max(500).optional(),
          })
          .strict(),
      )
      .max(32),
    termsHash: hash.nullable(),
    terms: publicBookingTermsSchema.nullable(),
    expiresAt: timestamp.nullable(),
    coverage: bookingCoverageReportSchema.optional(),
  })
  .strict();
const operation = z.enum(["book_trip", "reschedule_component", "cancel_component"]);
export const publicAuthorizationSchema = z
  .object({
    id: z.uuid(),
    tripId: z.uuid(),
    tripVersion: z.number().int().positive(),
    operation,
    componentId: z.uuid().nullable(),
    termsHash: hash,
    status: z.enum(["pending", "authorized", "invalidated", "expired", "consumed"]),
    authorizedAt: timestamp,
    expiresAt: timestamp,
    requestId: z.uuid().nullable().optional(),
  })
  .strict();
export const publicBookingTransactionSchema = z
  .object({
    id: z.uuid(),
    tripId: z.uuid(),
    authorizationId: z.uuid(),
    operation,
    status: z.enum([
      "requested",
      "running",
      "partially_confirmed",
      "confirmed",
      "action_required",
      "failed",
      "cancelled",
    ]),
    components: z
      .array(
        z
          .object({
            componentId: z.uuid(),
            status: z.enum([
              "proposed",
              "authorized",
              "not_attempted",
              "booking",
              "confirmed",
              "failed",
              "unknown",
              "action_required",
              "cancelled",
            ]),
            providerReference: z.string().max(512).nullable(),
            safeReason: z.string().max(500).nullable(),
          })
          .strict(),
      )
      .max(32),
    startedAt: timestamp,
    completedAt: timestamp.nullable(),
    requestId: z.uuid(),
    executionStatus: z.enum(["active", "invalidated", "expired", "completed"]),
    tripVersion: z.number().int().positive(),
    termsHash: hash,
    termsVersion: z.union([z.literal(1), z.literal(2)]),
    continuationOf: z.uuid().nullable(),
    rootAttemptId: z.uuid().nullable(),
  })
  .strict();
export type PublicBookingTransaction = z.infer<typeof publicBookingTransactionSchema>;
export const publicBookingStatusSchema = publicBookingTransactionSchema.extend({
  currentTripVersion: z.number().int().positive(),
});
export const bookingReviewStateSchema = z
  .object({
    tripId: z.uuid(),
    tripVersion: z.number().int().positive(),
    coverage: bookingCoverageReportSchema,
    review: revalidationViewSchema.nullable(),
    authorization: publicAuthorizationSchema.nullable(),
    activeAttempt: publicBookingTransactionSchema.nullable(),
    latestAttempt: publicBookingTransactionSchema.nullable(),
    history: z.array(publicBookingTransactionSchema).max(10),
    confirmedCommitments: z
      .array(
        z
          .object({
            id: z.uuid(),
            componentId: z.uuid(),
            providerReference: z.string().max(512),
            serviceStart: timestamp,
            serviceEnd: timestamp,
            travellerIds: z.array(z.uuid()).max(10),
            finalCustomerMinor: amount,
            currency,
            cancellationTerms: text,
            confirmedAt: timestamp,
          })
          .strict(),
      )
      .max(32),
  })
  .strict();
export type BookingReviewState = z.infer<typeof bookingReviewStateSchema>;
