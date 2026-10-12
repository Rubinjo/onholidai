import type { ColumnType, Generated, JSONColumnType } from "kysely";

import type { DraftOperation, TripSnapshot } from "@/domain/trip/schema";

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
  trips: TripTable;
  tripVersions: TripVersionTable;
  conversations: ConversationTable;
  conversationMessages: ConversationMessageTable;
  conversationSummaries: ConversationSummaryTable;
  outboxEvents: OutboxEventTable;
  idempotencyRecords: IdempotencyRecordTable;
  auditEvents: AuditEventTable;
}
