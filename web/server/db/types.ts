import type { ColumnType, Generated, JSONColumnType } from "kysely";

import type { DraftOperation, TripSnapshot } from "@/domain/trip/schema";
import type { ChangeProposal } from "@/domain/trip/proposal";

export type TripLifecycleState = "draft" | "finalized" | "partially_booked" | "booked" | "cancelled";
export type TripInitiatingActor = "user" | "agent_proposal" | "system_revalidation" | "booking_workflow";
export type IdempotencyState = "in_progress" | "completed" | "unknown";
export type OutboxDeliveryState = "pending" | "delivering" | "delivered" | "failed";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type GeneratedTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type Json<Value extends object | null> = JSONColumnType<Value, Value, Value>;

export interface TripTable {
  id: string;
  ownerUserId: string;
  title: string;
  lifecycleState: Generated<TripLifecycleState>;
  currentVersion: Generated<number>;
  currency: string;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  lastActivityAt: GeneratedTimestamp;
}

export interface TripVersionTable {
  tripId: string;
  version: number;
  previousVersion: number | null;
  schemaVersion: number;
  snapshot: Json<TripSnapshot>;
  initiatingActor: TripInitiatingActor;
  initiatingRequestId: string;
  proposalId: string | null;
  changeSummary: Json<string[]>;
  inverseOperation: Json<DraftOperation | null>;
  nonReversibleReason: string | null;
  createdAt: GeneratedTimestamp;
}

export interface ConversationTable {
  id: string;
  tripId: string;
  ownerUserId: string;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  retentionExpiresAt: Timestamp;
}

export interface ConversationMessageTable {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: Json<Record<string, unknown>>;
  tripVersion: number | null;
  agentRunId: string | null;
  createdAt: GeneratedTimestamp;
  retentionExpiresAt: Timestamp;
}

export interface ConversationSummaryTable {
  id: string;
  conversationId: string;
  summaryVersion: number;
  content: Json<Record<string, unknown>>;
  firstMessageId: string;
  lastMessageId: string;
  sourceTripVersion: number;
  tokenEstimate: number;
  createdAt: GeneratedTimestamp;
}

export interface OutboxEventTable {
  id: string;
  eventType: string;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: Json<Record<string, unknown>>;
  createdAt: GeneratedTimestamp;
  deliveryState: Generated<OutboxDeliveryState>;
  attempts: Generated<number>;
  nextAttemptAt: GeneratedTimestamp;
  leaseExpiresAt: Timestamp | null;
  deliveredAt: Timestamp | null;
  lastErrorCategory: string | null;
}

export interface IdempotencyRecordTable {
  scope: string;
  idempotencyKey: string;
  requestFingerprint: string;
  state: IdempotencyState;
  resultReference: Json<Record<string, unknown> | null>;
  createdAt: GeneratedTimestamp;
  updatedAt: GeneratedTimestamp;
  expiresAt: Timestamp;
}

export interface AuditEventTable {
  id: string;
  actorType: "user" | "service" | "system";
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  requestId: string;
  traceId: string | null;
  outcome: "allowed" | "denied" | "succeeded" | "failed";
  metadata: Json<Record<string, unknown>>;
  occurredAt: GeneratedTimestamp;
}

export interface TripCoreDatabase {
  agentRunEvents: AgentRunEventTable;
  agentRunResumes: AgentRunResumeTable;
  planningOfferRecords: PlanningOfferRecordTable;
  estimateCandidates: EstimateCandidateTable;
  agentRuns: AgentRunTable;
  changeProposals: ChangeProposalTable;
  trips: TripTable;
  tripVersions: TripVersionTable;
  conversations: ConversationTable;
  conversationMessages: ConversationMessageTable;
  conversationSummaries: ConversationSummaryTable;
  outboxEvents: OutboxEventTable;
  idempotencyRecords: IdempotencyRecordTable;
  auditEvents: AuditEventTable;
}

export interface AgentRunTable {
  dispatchFingerprint: Generated<string | null>;
  activeElapsedMs: Generated<number>;
  phaseStartedAt: GeneratedTimestamp;
  lastDurableProgressAt: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  resultFingerprint: Generated<string | null>;
  resultCursor: Generated<number | null>;
  id: string;
  tripId: string;
  conversationId: string;
  ownerUserId: string;
  requestId: string;
  baseTripVersion: number;
  purpose: ChangeProposal["purpose"];
  requestFingerprint: string;
  status: Generated<"queued" | "running" | "awaiting_clarification" | "proposed" | "completed" | "failed" | "cancelled">;
  eventCursor: Generated<number>;
  leaseExpiresAt: Timestamp | null;
  startedAt: GeneratedTimestamp;
  completedAt: Timestamp | null;
  errorCategory: "interrupted" | "deadline" | "source_unavailable" | "invalid_result" | null;
  result: Json<Record<string, unknown> | null>;
}

export interface AgentRunEventTable {
  runId: string; cursor: number; fingerprint: string;
  event: Json<Record<string, unknown>>; receipt: Json<Record<string, unknown>>;
  createdAt: GeneratedTimestamp;
}
export interface AgentRunResumeTable {
  runId: string; questionId: string; requestId: string; fingerprint: string;
  eventCursor: number;
  createdAt: GeneratedTimestamp;
}
export interface PlanningOfferRecordTable {
  runId: string; componentId: string; offer: Json<Record<string, unknown>>; createdAt: GeneratedTimestamp;
  query: Json<Record<string, unknown>>;
}
export interface EstimateCandidateTable { proposalId: string; snapshot: Json<TripSnapshot> }

export interface ChangeProposalTable {
  id: string;
  tripId: string;
  agentRunId: string;
  initiatingRequestId: string;
  baseTripVersion: number;
  purpose: ChangeProposal["purpose"];
  proposal: Json<ChangeProposal>;
  requestFingerprint: string;
  status: ChangeProposal["status"];
  createdAt: Timestamp;
  expiresAt: Timestamp;
  appliedVersion: number | null;
}
