import type { BookingTerms } from "@/domain/booking/authorization";
import type { BookingCoverageReport } from "@/domain/trip/booking-coverage";
import type { BookingComponentState, BookingTransaction } from "@/domain/booking/schema";

export interface RevalidationWorkflowInput {
  workflowId: string;
  tripId: string;
  ownerUserId: string;
  tripVersion: number;
}
export interface ComponentRescheduleWorkflowInput extends RevalidationWorkflowInput {
  bookingId: string;
  componentId: string;
  requestedChange: {
    serviceStart?: string;
    serviceEnd?: string;
    supplierOfferId?: string;
    travellerIds?: string[];
    note?: string;
  };
}
export interface RevalidationWorkflowResult {
  workflowId: string;
  status: "completed" | "failed";
  outcomes: Array<{
    componentId: string;
    outcome: "unchanged" | "changed" | "unavailable" | "unknown";
    safeReason?: string;
  }>;
  terms: BookingTerms | null;
  termsHash: string | null;
  expiresAt: string | null;
  coverage?: BookingCoverageReport;
}
export interface BookingWorkflowInput {
  transactionId: string;
}
export interface BookingWorkflowActivities {
  revalidateBooking(input: RevalidationWorkflowInput): Promise<RevalidationWorkflowResult>;
  revalidateComponentReschedule(
    input: ComponentRescheduleWorkflowInput,
  ): Promise<RevalidationWorkflowResult>;
  loadBookingTransaction(transactionId: string): Promise<BookingTransaction>;
  assertExecutionBasis(transactionId: string, componentId: string): Promise<void>;
  claimProviderWrite(
    transactionId: string,
    componentId: string,
  ): Promise<{ allowed: boolean; idempotencyKey: string; requestFingerprint: string }>;
  executeProviderWrite(
    transactionId: string,
    componentId: string,
    idempotencyKey: string,
    requestFingerprint: string,
  ): Promise<BookingComponentState>;
  recordBookingOutcome(transactionId: string, outcome: BookingComponentState): Promise<void>;
  reconcileProviderStatus(
    transactionId: string,
    componentId: string,
  ): Promise<BookingComponentState>;
}
