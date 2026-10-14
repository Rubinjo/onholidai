import { z } from "zod";
import { setupDraftPayloadSchema, setupStepSchema } from "@/components/trip-setup/draft-schema";

export const planningPrincipalSchema = z.object({ id: z.string().min(1), accountUserId: z.string().min(1).nullable(),
  guestSessionId: z.uuid().nullable(), originKind: z.enum(["account", "guest"]), isDefault: z.boolean(),
  createdAt: z.date(), linkedAt: z.date().nullable() }).strict().refine(
  (value) => (value.accountUserId !== null) !== (value.guestSessionId !== null), "One authority is required");
export const setupDraftEnvelopeSchema = z.object({ draftId: z.uuid(), revision: z.number().int().positive(),
  currentStep: setupStepSchema, payload: setupDraftPayloadSchema, submittedTripId: z.uuid().nullable(), updatedAt: z.iso.datetime() }).strict();
export const saveSetupDraftSchema = z.object({ requestId: z.uuid(), expectedRevision: z.number().int().positive(),
  currentStep: setupStepSchema, payload: setupDraftPayloadSchema }).strict();
export const submitSetupDraftSchema = z.object({ expectedRevision: z.number().int().positive() }).strict();
