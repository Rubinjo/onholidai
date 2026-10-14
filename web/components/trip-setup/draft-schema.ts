import { z } from "zod";
import { currencySchema, departureOriginSchema, destinationSchema, preferenceProfileSchema,
  timezoneSchema, tripConstraintSchema } from "@/domain/trip/schema";

export const setupStepSchema = z.enum(["destinations", "origin", "dates", "travellers", "preferences", "review"]);
const nullableNumber = z.number().int().min(1).max(365).nullable();
export const setupDraftPayloadSchema = z.object({
  title: z.string().max(120), currency: currencySchema,
  departureOrigin: z.object({ ...departureOriginSchema.shape, confirmedByUser: z.boolean() }).strict().nullable(),
  destinations: z.array(destinationSchema).max(8),
  availabilityWindows: z.array(z.object({ id: z.uuid(), startDate: z.union([z.literal(""), z.iso.date()]),
    endDate: z.union([z.literal(""), z.iso.date()]), preference: z.enum(["preferred", "flexible"]),
    timezone: timezoneSchema }).strict()).max(32),
  duration: z.object({ minimumDays: nullableNumber, idealDays: nullableNumber, maximumDays: nullableNumber }).strict(),
  travellerParty: z.object({ adults: z.number().int().min(1).max(10).nullable(),
    children: z.array(z.object({ id: z.uuid(), ageAtTripStart: z.number().int().min(0).max(17).nullable() }).strict()).max(9)
  }).strict().refine((party) => (party.adults ?? 0) + party.children.length <= 10, "At most ten travellers"),
  preferences: preferenceProfileSchema,
  constraints: z.array(z.object({ ...tripConstraintSchema.shape, statement: z.string().max(1000) }).strict()).max(64),
}).strict().superRefine((payload, context) => {
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 262144) {
    context.addIssue({ code: "custom", message: "Draft is too large" });
  }
  for (const entries of [payload.destinations, payload.availabilityWindows, payload.travellerParty.children, payload.constraints]) {
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) context.addIssue({ code: "custom", message: "Repeated entry ID" });
  }
});
export type SetupDraftPayload = z.infer<typeof setupDraftPayloadSchema>;
export type SetupStep = z.infer<typeof setupStepSchema>;
export function emptySetupDraft(): SetupDraftPayload {
  return { title: "", currency: "EUR", departureOrigin: null, destinations: [], availabilityWindows: [],
    duration: { minimumDays: null, idealDays: null, maximumDays: null }, travellerParty: { adults: null, children: [] },
    preferences: { pace: 50, spend: 50, discovery: 50, independence: 50, setting: 50 }, constraints: [] };
}
