import { z } from "zod";

import { bookingTermsSchema, type BookingOperation } from "./authorization";

export const executionBasisSchema = z
  .object({
    ownerUserId: z.string().min(1),
    operation: z.enum(["book_trip", "reschedule_component", "cancel_component"]),
    authorizationId: z.uuid(),
    startingTripVersion: z.number().int().positive(),
    terms: bookingTermsSchema,
    termsHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const bookingComponentStateSchema = z
  .object({
    componentId: z.uuid(),
    status: z.enum([
      "proposed",
      "authorized",
      "booking",
      "confirmed",
      "failed",
      "unknown",
      "action_required",
      "cancelled",
    ]),
    providerReference: z.string().nullable().default(null),
    safeReason: z.string().max(500).nullable().default(null),
  })
  .strict();

export const bookingTransactionSchema = z
  .object({
    id: z.uuid(),
    tripId: z.uuid(),
    authorizationId: z.uuid(),
    operation: z.enum(["book_trip", "reschedule_component", "cancel_component"]),
    status: z.enum([
      "requested",
      "running",
      "partially_confirmed",
      "confirmed",
      "action_required",
      "failed",
      "cancelled",
    ]),
    components: z.array(bookingComponentStateSchema),
    startedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable().default(null),
    executionBasis: executionBasisSchema,
    lastObservedTripVersion: z.number().int().positive(),
    executionStatus: z.enum(["active", "invalidated", "expired", "completed"]),
    workflowId: z.string().min(1).max(256),
    requestId: z.uuid(),
  })
  .strict()
  .superRefine((transaction, context) => {
    if (transaction.executionBasis.operation !== transaction.operation) {
      context.addIssue({
        code: "custom",
        path: ["executionBasis", "operation"],
        message: "Execution basis operation must match transaction",
      });
    }
  });

export type BookingTransaction = z.infer<typeof bookingTransactionSchema>;
export type BookingComponentState = z.infer<typeof bookingComponentStateSchema>;
export type BookingComponentStatus = BookingComponentState["status"];

// Stored booking rows keep the owner beside the transaction; the transaction
// contract carries it inside the immutable execution basis instead.
export function projectBookingTransactionRow(row: {
  id: string;
  tripId: string;
  authorizationId: string;
  operation: BookingTransaction["operation"];
  workflowId: string;
  requestId: string;
  status: BookingTransaction["status"];
  components: unknown;
  executionBasis: unknown;
  lastObservedTripVersion: number;
  executionStatus: BookingTransaction["executionStatus"];
  startedAt: Date;
  completedAt: Date | null;
}): BookingTransaction {
  return bookingTransactionSchema.parse({
    id: row.id,
    tripId: row.tripId,
    authorizationId: row.authorizationId,
    operation: row.operation,
    workflowId: row.workflowId,
    requestId: row.requestId,
    status: row.status,
    components: row.components,
    executionBasis: row.executionBasis,
    lastObservedTripVersion: row.lastObservedTripVersion,
    executionStatus: row.executionStatus,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  });
}

export const bookingAttemptSchema = z
  .object({
    id: z.uuid(),
    transactionId: z.uuid(),
    componentId: z.uuid(),
    operation: z.enum(["book_trip", "reschedule_component", "cancel_component"]),
    idempotencyKey: z.string().min(1).max(256),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    providerAttempt: z.number().int().positive(),
    status: z.enum(["claimed", "dispatched", "confirmed", "failed", "unknown", "reconciled"]),
    providerReference: z.string().nullable(),
    safeReason: z.string().max(500).nullable(),
    statusCheckedAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const bookingConfirmationSchema = z
  .object({
    id: z.uuid(),
    transactionId: z.uuid(),
    componentId: z.uuid(),
    providerReference: z.string().min(1).max(512),
    serviceStart: z.iso.datetime({ offset: true }),
    serviceEnd: z.iso.datetime({ offset: true }),
    travellerIds: z.array(z.uuid()),
    finalCustomerMinor: z.number().int().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    cancellationTerms: z.string().min(1).max(4000),
    reschedulingTerms: z.string().max(4000).nullable(),
    travellerInstructions: z.string().max(4000).nullable(),
    confirmedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export function componentIdempotencyKey(
  transactionId: string,
  componentId: string,
  operation: BookingOperation,
  termsHash: string,
): string {
  return `${transactionId}:${componentId}:${operation}:${termsHash}`;
}
