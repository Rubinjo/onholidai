import { z } from "zod";

export const chatVersionSchema = z.object({
  version: z.number().int().positive(),
  previousVersion: z.number().int().positive().nullable(),
  actor: z.enum(["user", "agent_proposal", "system_revalidation", "booking_workflow"]).optional(),
  requestId: z.uuid().optional(),
  proposalId: z.uuid().nullable().optional(),
  summary: z.array(z.string()),
  createdAt: z.string(),
  runId: z.uuid().nullable(),
  restorable: z.boolean(),
  restoreReason: z.string().nullable(),
});
export const chatVersionsSchema = z.object({
  items: z.array(chatVersionSchema),
  nextBeforeVersion: z.number().int().positive().nullable(),
});
