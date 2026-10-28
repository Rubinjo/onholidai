import { z } from "zod";

export const feasibilityIssueSchema = z
  .object({ code: z.string(), message: z.string(), relatedIds: z.array(z.uuid()) })
  .strict();

const text = (max: number) => z.string().trim().min(1).max(max);
const timestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)), "Expected a UTC timestamp");
export const verificationSchema = z.enum(["verified", "unverified", "failed"]);
export const bookingDispositionFields = {
  bookingDisposition: z.enum(["required", "not_required", "unknown"]).optional(),
  bookingDispositionEvidence: z
    .object({
      source: text(500),
      verificationStatus: verificationSchema,
      checkedAt: timestamp,
    })
    .strict()
    .optional(),
};
export const constraintEvidenceSchema = z
  .object({
    constraintId: z.uuid(),
    status: verificationSchema,
    source: text(500),
    checkedAt: timestamp,
  })
  .strict();
export const itemEvidenceFields = {
  ...bookingDispositionFields,
  title: text(200).optional(),
  practicalNotes: z.array(text(1000)).max(16).optional(),
  startOffset: z
    .string()
    .regex(/^[+-]\d{2}:\d{2}$/)
    .optional(),
  endOffset: z
    .string()
    .regex(/^[+-]\d{2}:\d{2}$/)
    .optional(),
  priority: z.enum(["required", "strong", "preference"]).optional(),
  durationUpperBoundMinutes: z.number().int().positive().nullable().optional(),
  timingEvidence: z.array(text(500)).max(32).optional(),
  verificationStatus: verificationSchema.optional(),
  feasibilityPolicyVersion: z.literal("1").optional(),
  constraintEvidence: z.array(constraintEvidenceSchema).max(64).optional(),
  transitionFromPrevious: z
    .object({
      durationMinutes: z.number().int().nonnegative(),
      durationUpperBoundMinutes: z.number().int().nonnegative().nullable(),
      source: text(500),
      checkedAt: timestamp,
      verificationStatus: verificationSchema,
    })
    .strict()
    .optional(),
};
export const segmentGuidanceFields = {
  international: z.boolean().optional(),
  providerArrivalMinutes: z.number().int().nonnegative().optional(),
  connectionMinimumMinutes: z.number().int().nonnegative().nullable().optional(),
  connectionFromItemId: z.uuid().optional(),
  departureGuidance: text(2000).optional(),
};

// A fare can cover a whole outbound-and-return journey, so each flown direction keeps
// its own airports, instants and zones. The component's service window spans them all.
export const flightJourneySchema = z
  .object({
    direction: z.enum(["outbound", "return", "multi_city"]),
    origin: text(120),
    destination: text(120),
    originTimezone: text(120).nullable(),
    destinationTimezone: text(120).nullable(),
    departingAt: timestamp,
    arrivingAt: timestamp,
    legs: z.array(text(500)).max(16),
  })
  .strict()
  .refine(
    (journey) => Date.parse(journey.arrivingAt) > Date.parse(journey.departingAt),
    "A flight journey must arrive after it departs",
  );

export type FlightJourney = z.infer<typeof flightJourneySchema>;

// Additive optional facts keep immutable v1 snapshots readable. Absence never
// becomes a verified pass; the finalization oracle discloses it explicitly.
export const planningDetailsSchema = z
  .object({
    locationName: text(500).nullable(),
    timezone: text(120).nullable(),
    airportNames: z.array(text(200)).max(8),
    airlines: z.array(text(200)).max(8),
    flightDirection: z.enum(["outbound", "return", "multi_city"]).nullable(),
    flightJourneys: z.array(flightJourneySchema).max(8).optional(),
    durationMinutes: z.number().int().positive().nullable(),
    layovers: z.array(text(500)).max(8),
    fareConditions: text(2000).nullable(),
    accommodationType: text(200).nullable(),
    travelFromStayMinutes: z.number().int().nonnegative().nullable(),
    eligibility: verificationSchema,
    accessibility: verificationSchema,
    availability: verificationSchema,
    constraintEvidence: z.array(constraintEvidenceSchema).max(64),
    source: text(500),
    checkedAt: timestamp,
    unavailableFacts: z.array(text(200)).max(32),
  })
  .strict();

export type PlanningDetails = z.infer<typeof planningDetailsSchema>;
