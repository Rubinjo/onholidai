import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)), "Expected a UTC timestamp");
export const verificationSchema = z.enum(["verified", "unverified", "failed"]);
export const constraintEvidenceSchema = z.object({
  constraintId: z.uuid(), status: verificationSchema, source: text(500), checkedAt: timestamp,
}).strict();
export const itemEvidenceFields = {
  title: text(200).optional(), practicalNotes: z.array(text(1000)).max(16).optional(),
  startOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/).optional(),
  endOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/).optional(),
  priority: z.enum(["required", "strong", "preference"]).optional(),
  durationUpperBoundMinutes: z.number().int().positive().nullable().optional(),
  timingEvidence: z.array(text(500)).max(32).optional(),
  verificationStatus: verificationSchema.optional(), feasibilityPolicyVersion: z.literal("1").optional(),
  constraintEvidence: z.array(constraintEvidenceSchema).max(64).optional(),
  transitionFromPrevious: z.object({ durationMinutes: z.number().int().nonnegative(),
    durationUpperBoundMinutes: z.number().int().nonnegative().nullable(), source: text(500),
    checkedAt: timestamp, verificationStatus: verificationSchema }).strict().optional(),
};
export const segmentGuidanceFields = {
  international: z.boolean().optional(), providerArrivalMinutes: z.number().int().nonnegative().optional(),
  connectionMinimumMinutes: z.number().int().nonnegative().nullable().optional(),
  connectionFromItemId: z.uuid().optional(),
  departureGuidance: text(2000).optional(),
};

// Additive optional facts keep immutable v1 snapshots readable. Absence never
// becomes a verified pass; the finalization oracle discloses it explicitly.
export const planningDetailsSchema = z.object({
  locationName: text(500).nullable(), timezone: text(120).nullable(),
  airportNames: z.array(text(200)).max(8), airlines: z.array(text(200)).max(8),
  flightDirection: z.enum(["outbound", "return", "multi_city"]).nullable(),
  durationMinutes: z.number().int().positive().nullable(), layovers: z.array(text(500)).max(8),
  fareConditions: text(2000).nullable(), accommodationType: text(200).nullable(),
  travelFromStayMinutes: z.number().int().nonnegative().nullable(),
  eligibility: verificationSchema, accessibility: verificationSchema, availability: verificationSchema,
  constraintEvidence: z.array(constraintEvidenceSchema).max(64),
  source: text(500), checkedAt: timestamp, unavailableFacts: z.array(text(200)).max(32),
}).strict();

export type PlanningDetails = z.infer<typeof planningDetailsSchema>;
