import { createHash, randomUUID } from "node:crypto";

import { sql, type Kysely, type Transaction } from "kysely";
import { z } from "zod";

import { inTransaction } from "@/server/db/transaction";
import { canonicalJson } from "@/domain/canonical-json";
import { ProblemError } from "@/server/errors";
import { redactConversation } from "@/server/db/conversation-repository";
import { rawConversationExpiry } from "@/server/privacy/retention";
import { checkGuestResearch } from "@/server/metrics/guest-planning";
import { AGENT_LEASE_MS, CLARIFICATION_IDLE_MS } from "@/server/agent-client/run-lifecycle";
import { lockPlanningAccess } from "@/server/db/planning-access";
import { planningProblems } from "@/server/errors";
import { lockServiceGrant } from "@/server/auth/planning-resource";
import { selectedOffersSchema } from "@/domain/trip/proposal";

import {
  AgentEventSchema,
  AgentPersistenceReceiptSchema,
  AgentRunSchema,
  AnswerClarificationRequestSchema,
  PersistAgentEventRequestSchema,
  PersistAgentResultRequestSchema,
} from "../../../contracts/agent-api/generated.zod";

import type { PlanningActor } from "@/server/auth/planning-actor";
import type { ServiceTokenContext } from "./credentials";
import type { Selectable } from "kysely";
import type { AgentRunTable } from "@/server/db/types";
import type { Database } from "@/server/db/database";
import type { AgentEvent, AgentRun } from "../../../contracts/agent-api/generated";

export const reserveRunSchema = z
  .object({
    userId: z.uuid(),
    tripId: z.uuid(),
    requestId: z.uuid(),
    baseTripVersion: z.number().int().positive(),
    purpose: z.enum(["initial_estimate", "refinement", "finalization", "supplier_research"]),
    message: z.string().trim().min(1).max(12000),
    applicationPolicy: z.enum(["manual", "automatic"]).optional(),
    selectedOffers: selectedOffersSchema.optional(),
  })
  .strict();
export function runConflict(): never {
  throw new ProblemError({ title: "Run state conflict", status: 409, code: "run_conflict" });
}
export type FailureCategory = NonNullable<AgentRunTable["errorCategory"]>;
const FAILURE_CATEGORIES: Partial<Record<string, FailureCategory>> = {
  estimate_deadline: "deadline",
  source_unavailable: "source_unavailable",
  invalid_result: "invalid_result",
};
// Only a web-rejected proposal proves the supplier evidence was unusable. Any other
// agent exception is an unexpected service failure and must not claim that cause.
export function failureCategory(event: AgentEvent): FailureCategory {
  return event.type === "failed"
    ? (FAILURE_CATEGORIES[event.safeErrorCode ?? ""] ?? "agent_error")
    : "agent_error";
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export async function revokePrincipalRuns(
  transaction: Transaction<Database>,
  planningOwnerId: string,
  now: Date,
): Promise<void> {
  const rows = await transaction
    .selectFrom("agentRuns")
    .selectAll()
    .where("ownerUserId", "=", planningOwnerId)
    .where("planningAccessRevokedAt", "is", null)
    .orderBy("id")
    .forUpdate()
    .execute();
  for (const row of rows) {
    const active = ["queued", "running", "awaiting_clarification"].includes(row.status);
    if (active) {
      const cursor = row.eventCursor + 1;
      const event = AgentEventSchema.parse({
        version: "1",
        runId: row.id,
        cursor,
        occurredAt: now.toISOString(),
        type: "failed",
        status: "failed",
        safeErrorCode: "planning_run_access_revoked",
      });
      await transaction
        .insertInto("agentRunEvents")
        .values({
          runId: row.id,
          cursor,
          fingerprint: fingerprint(event),
          event: { ...event },
          receipt: {
            runId: row.id,
            requestId: row.requestId,
            acceptedCursor: cursor,
            resultRecorded: true,
          },
        })
        .execute();
      await transaction
        .updateTable("agentRuns")
        .set({
          planningAccessRevokedAt: now,
          status: "failed",
          errorCategory: "interrupted",
          eventCursor: cursor,
          leaseExpiresAt: null,
          completedAt: now,
          result: null,
        })
        .where("id", "=", row.id)
        .execute();
    } else
      await transaction
        .updateTable("agentRuns")
        .set({ planningAccessRevokedAt: now })
        .where("id", "=", row.id)
        .execute();
  }
}
const lease = (now: Date) => new Date(now.getTime() + AGENT_LEASE_MS);
export function runContext(run: AgentRun & { ownerUserId: string }): ServiceTokenContext {
  return {
    userId: run.ownerUserId,
    tripId: run.tripId,
    requestId: run.requestId,
    baseTripVersion: run.baseTripVersion,
  };
}
function envelope(row: Selectable<AgentRunTable>): AgentRun & { ownerUserId: string } {
  return {
    ...AgentRunSchema.parse({
      id: row.id,
      requestId: row.requestId,
      tripId: row.tripId,
      conversationId: row.conversationId,
      baseTripVersion: row.baseTripVersion,
      purpose: row.purpose,
      status: row.status,
      result: row.result,
      nextEventCursor: row.eventCursor,
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      lastDurableProgressAt: row.lastDurableProgressAt?.toISOString() ?? null,
      interruptionReason: row.errorCategory === "interrupted" ? "lease_expired" : null,
      createdAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    }),
    ownerUserId: row.ownerUserId,
  };
}
export class RunRepository {
  constructor(
    private readonly database: Kysely<Database>,
    private readonly now: () => Date = () => new Date(),
    private readonly limits = { active: 2, hourly: 10 },
  ) {}
  private async lock(transaction: Transaction<Database>, userId: string, runId: string) {
    const run = await transaction
      .selectFrom("agentRuns")
      .innerJoin("trips", "trips.id", "agentRuns.tripId")
      .selectAll("agentRuns")
      .where("agentRuns.id", "=", runId)
      .where("trips.ownerUserId", "=", userId)
      .where("agentRuns.ownerUserId", "=", userId)
      .forUpdate("agentRuns")
      .executeTakeFirst();
    if (!run)
      throw new ProblemError({ title: "Run not found", status: 404, code: "run_not_found" });
    return run;
  }
  private bind(
    run: Pick<
      Selectable<AgentRunTable>,
      "ownerUserId" | "tripId" | "requestId" | "baseTripVersion"
    > & { planningAccessRevokedAt?: Date | null },
    context: ServiceTokenContext,
  ) {
    if (run.planningAccessRevokedAt) throw planningProblems.planningRunAccessRevoked();
    if (
      run.ownerUserId !== context.userId ||
      run.tripId !== context.tripId ||
      run.requestId !== context.requestId ||
      run.baseTripVersion !== context.baseTripVersion
    )
      runConflict();
  }
  private async interrupt(transaction: Transaction<Database>, row: Selectable<AgentRunTable>) {
    const expiredLease =
      ["queued", "running"].includes(row.status) &&
      row.leaseExpiresAt !== null &&
      row.leaseExpiresAt <= this.now();
    const abandonedClarification =
      row.status === "awaiting_clarification" &&
      row.phaseStartedAt.getTime() + CLARIFICATION_IDLE_MS <= this.now().getTime();
    if (expiredLease || abandonedClarification) {
      // A run whose agent recorded a failed event but could not record its result is
      // interrupted here. Keep that recorded cause instead of replacing it with the
      // transport-level verdict, so the traveller sees the real reason.
      const lastEvent = expiredLease
        ? await transaction
            .selectFrom("agentRunEvents")
            .select("event")
            .where("runId", "=", row.id)
            .where("cursor", "=", row.eventCursor)
            .executeTakeFirst()
        : undefined;
      const recordedFailure = lastEvent ? AgentEventSchema.safeParse(lastEvent.event) : undefined;
      const category: FailureCategory =
        recordedFailure?.success && recordedFailure.data.type === "failed"
          ? failureCategory(recordedFailure.data)
          : "interrupted";
      const cursor = row.eventCursor + 1;
      const event = AgentEventSchema.parse({
        version: "1",
        runId: row.id,
        cursor,
        occurredAt: this.now().toISOString(),
        type: "failed",
        status: "failed",
        safeErrorCode: expiredLease ? "lease_expired" : "clarification_expired",
      });
      await transaction
        .insertInto("agentRunEvents")
        .values({
          runId: row.id,
          cursor,
          fingerprint: fingerprint(event),
          event: { ...event },
          receipt: {
            runId: row.id,
            requestId: row.requestId,
            acceptedCursor: cursor,
            resultRecorded: true,
          },
        })
        .execute();
      const updated = await transaction
        .updateTable("agentRuns")
        .set({
          status: "failed",
          errorCategory: category,
          eventCursor: cursor,
          leaseExpiresAt: null,
          completedAt: this.now(),
          result: null,
        })
        .where("id", "=", row.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("auditEvents")
        .values({
          id: randomUUID(),
          actorType: "system",
          actorId: "run-lease-monitor",
          action: "estimate.run.result",
          targetType: "agent_run",
          targetId: row.id,
          requestId: row.requestId,
          traceId: null,
          outcome: "failed",
          metadata: {
            durationMs:
              Number(row.activeElapsedMs) +
              Math.max(0, this.now().getTime() - row.phaseStartedAt.getTime()),
            resultKind: "failed",
            errorCategory: category,
          },
        })
        .execute();
      return updated;
    }
    return row;
  }
  async reserve(raw: unknown) {
    const input = reserveRunSchema.parse(raw),
      hash = fingerprint(input),
      now = this.now();
    return inTransaction(this.database, async (transaction) => {
      const principal = await transaction
        .selectFrom("planningPrincipals")
        .selectAll()
        .where("id", "=", input.userId)
        .executeTakeFirstOrThrow();
      const actor: PlanningActor = principal.accountUserId
        ? { kind: "account", planningOwnerId: principal.id, accountUserId: principal.accountUserId }
        : {
            kind: "guest",
            planningOwnerId: principal.id,
            guestSessionId: principal.guestSessionId!,
          };
      await lockPlanningAccess(transaction, actor, now);
      const trip = await transaction
        .selectFrom("trips")
        .selectAll()
        .where("id", "=", input.tripId)
        .where("ownerUserId", "=", input.userId)
        .forUpdate()
        .executeTakeFirst();
      if (!trip)
        throw new ProblemError({ title: "Trip not found", status: 404, code: "trip_not_found" });
      const previous = await transaction
        .selectFrom("agentRuns")
        .selectAll()
        .where("ownerUserId", "=", input.userId)
        .where("requestId", "=", input.requestId)
        .executeTakeFirst();
      if (previous) {
        if (previous.requestFingerprint !== hash) runConflict();
        return envelope(
          await this.interrupt(
            transaction,
            await this.lock(transaction, input.userId, previous.id),
          ),
        );
      }
      if (trip.currentVersion !== input.baseTripVersion || trip.lifecycleState !== "draft")
        runConflict();
      if (input.selectedOffers) {
        if (input.purpose !== "refinement") runConflict();
        const { selectedResearchRecords } = await import("@/server/supply/planning-research");
        await selectedResearchRecords(transaction, input, input.selectedOffers, now);
      }
      if (actor.kind === "guest") {
        const reused = await transaction
          .selectFrom("guestResearchRequests")
          .select("runId")
          .where("guestSessionId", "=", actor.guestSessionId)
          .where("requestId", "=", input.requestId)
          .executeTakeFirst();
        if (reused) runConflict();
        await checkGuestResearch(transaction, actor.guestSessionId, this.limits, now);
      }
      const conversation = await transaction
        .selectFrom("conversations")
        .select("id")
        .where("tripId", "=", input.tripId)
        .where("ownerUserId", "=", input.userId)
        .orderBy("createdAt", "desc")
        .executeTakeFirst();
      const conversationId = conversation?.id ?? randomUUID(),
        id = randomUUID();
      if (!conversation)
        await transaction
          .insertInto("conversations")
          .values({
            id: conversationId,
            tripId: input.tripId,
            ownerUserId: input.userId,
            retentionExpiresAt: rawConversationExpiry(now),
          })
          .execute();
      const row = await transaction
        .insertInto("agentRuns")
        .values({
          id,
          tripId: input.tripId,
          conversationId,
          ownerUserId: input.userId,
          requestId: input.requestId,
          baseTripVersion: input.baseTripVersion,
          purpose: input.purpose,
          applicationPolicy: input.applicationPolicy ?? "manual",
          requestFingerprint: hash,
          leaseExpiresAt: lease(now),
          startedAt: now,
          phaseStartedAt: now,
          completedAt: null,
          errorCategory: null,
          result: null,
          lastDurableProgressAt: null,
          resultFingerprint: null,
          resultCursor: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      if (actor.kind === "guest")
        await transaction
          .insertInto("guestResearchRequests")
          .values({
            guestSessionId: actor.guestSessionId,
            requestId: input.requestId,
            runId: id,
            acceptedAt: now,
          })
          .execute();
      // Persist typed metadata, not raw personal free text; the request remains bounded and ephemeral.
      await transaction
        .insertInto("conversationMessages")
        .values({
          id: randomUUID(),
          conversationId,
          role: "user",
          content: {
            kind: "research_request",
            purpose: input.purpose,
            text: redactConversation(input.message),
            ...(input.selectedOffers ? { selectedOffers: input.selectedOffers } : {}),
          },
          tripVersion: input.baseTripVersion,
          agentRunId: id,
          retentionExpiresAt: rawConversationExpiry(now),
        })
        .execute();
      return envelope(row);
    });
  }
  async read(userId: string, runId: string) {
    return inTransaction(this.database, async (transaction) =>
      envelope(await this.interrupt(transaction, await this.lock(transaction, userId, runId))),
    );
  }
  async readScoped(context: ServiceTokenContext, runId: string) {
    return inTransaction(this.database, async (transaction) => {
      const row = await this.lock(transaction, context.userId, runId);
      this.bind(row, context);
      return envelope(await this.interrupt(transaction, row));
    });
  }
  async validateDispatch(context: ServiceTokenContext, runId: string, raw: unknown) {
    const { CreateAgentRunRequestSchema } =
      await import("../../../contracts/agent-api/generated.zod");
    const input = CreateAgentRunRequestSchema.parse(raw);
    return inTransaction(this.database, async (transaction) => {
      const row = await this.lock(transaction, context.userId, runId);
      this.bind(row, context);
      const reservation = {
        userId: input.actor.userId,
        tripId: input.actor.tripId,
        requestId: input.requestId,
        baseTripVersion: input.actor.baseTripVersion,
        purpose: input.purpose,
        message: input.message,
        ...(input.selectedOffers ? { selectedOffers: input.selectedOffers } : {}),
      };
      // Reservations may omit the default policy; only the stored policy is authoritative.
      if (
        row.conversationId !== input.conversationId ||
        (row.requestFingerprint !== fingerprint(reservation) &&
          row.requestFingerprint !==
            fingerprint({ ...reservation, applicationPolicy: row.applicationPolicy }))
      )
        runConflict();
      const hash = fingerprint(input);
      if (row.dispatchFingerprint && row.dispatchFingerprint !== hash) runConflict();
      if (!row.dispatchFingerprint)
        await transaction
          .updateTable("agentRuns")
          .set({
            dispatchFingerprint: hash,
            dispatchRequest: { ...input, message: redactConversation(input.message) },
          })
          .where("id", "=", runId)
          .execute();
      return { accepted: true };
    });
  }
  async event(context: ServiceTokenContext, runId: string, cursor: number, raw: unknown) {
    const input = PersistAgentEventRequestSchema.parse(raw);
    this.bind(
      {
        ownerUserId: input.userId,
        tripId: input.tripId,
        requestId: input.requestId,
        baseTripVersion: input.baseTripVersion,
      },
      context,
    );
    if (input.event.runId !== runId || input.event.cursor !== cursor) runConflict();
    const hash = fingerprint(input);
    return inTransaction(this.database, async (transaction) => {
      const row = await this.lock(transaction, context.userId, runId);
      this.bind(row, context);
      const existing = await transaction
        .selectFrom("agentRunEvents")
        .selectAll()
        .where("runId", "=", runId)
        .where("cursor", "=", cursor)
        .executeTakeFirst();
      if (existing) {
        if (existing.fingerprint !== hash) runConflict();
        return AgentPersistenceReceiptSchema.parse(existing.receipt);
      }
      if (
        !["queued", "running"].includes(row.status) ||
        !row.leaseExpiresAt ||
        row.leaseExpiresAt <= this.now() ||
        cursor !== row.eventCursor + 1
      )
        runConflict();
      if (input.event.type === "proposal" && input.event.proposal.purpose !== row.purpose)
        runConflict();
      const receipt = {
        runId,
        requestId: context.requestId,
        acceptedCursor: cursor,
        resultRecorded: false,
      };
      await transaction
        .insertInto("agentRunEvents")
        .values({ runId, cursor, fingerprint: hash, event: { ...input.event }, receipt })
        .execute();
      if (input.event.type === "progress" && !row.lastDurableProgressAt) {
        await transaction
          .insertInto("auditEvents")
          .values({
            id: randomUUID(),
            actorType: "service",
            actorId: context.userId,
            action: "estimate.run.first_progress",
            targetType: "agent_run",
            targetId: runId,
            requestId: context.requestId,
            traceId: null,
            outcome: "succeeded",
            metadata: { durationMs: Math.max(0, this.now().getTime() - row.startedAt.getTime()) },
          })
          .execute();
      }
      await transaction
        .updateTable("agentRuns")
        .set({
          eventCursor: cursor,
          status: "running",
          leaseExpiresAt: lease(this.now()),
          lastDurableProgressAt: this.now(),
        })
        .where("id", "=", runId)
        .execute();
      return receipt;
    });
  }
  async result(context: ServiceTokenContext, runId: string, raw: unknown) {
    const input = PersistAgentResultRequestSchema.parse(raw),
      hash = fingerprint(input);
    if (
      input.userId !== context.userId ||
      input.tripId !== context.tripId ||
      input.requestId !== context.requestId ||
      input.baseTripVersion !== context.baseTripVersion
    )
      runConflict();
    return inTransaction(this.database, async (transaction) => {
      // Also protects direct repository callers. Lock access/trip before run/proposal.
      await lockServiceGrant(transaction, context);
      const row = await this.lock(transaction, context.userId, runId);
      this.bind(row, context);
      const receipt = {
        runId,
        requestId: context.requestId,
        acceptedCursor: input.eventCursor,
        resultRecorded: true,
      };
      if (row.resultFingerprint === hash && row.resultCursor === input.eventCursor) return receipt;
      if (
        !["queued", "running"].includes(row.status) ||
        !row.leaseExpiresAt ||
        row.leaseExpiresAt <= this.now() ||
        row.eventCursor !== input.eventCursor
      )
        runConflict();
      const stored = await transaction
        .selectFrom("agentRunEvents")
        .select("event")
        .where("runId", "=", runId)
        .where("cursor", "=", input.eventCursor)
        .executeTakeFirst();
      if (!stored) runConflict();
      const event = AgentEventSchema.parse(stored.event);
      if (input.status === "proposed") {
        if (
          event.type !== "proposal" ||
          input.result?.kind !== "proposal" ||
          canonicalJson(event.proposal) !== canonicalJson(input.result.proposal) ||
          event.proposal.purpose !== row.purpose
        )
          runConflict();
        const proposal = await transaction
          .selectFrom("changeProposals")
          .select("id")
          .where("id", "=", event.proposal.id)
          .where("agentRunId", "=", runId)
          .executeTakeFirst();
        if (!proposal) runConflict();
      } else if (input.status === "awaiting_clarification") {
        if (
          event.type !== "clarification" ||
          input.result?.kind !== "clarification" ||
          canonicalJson(event.clarification) !== canonicalJson(input.result.clarification)
        )
          runConflict();
      } else if (event.type !== input.status) runConflict();
      await transaction
        .updateTable("agentRuns")
        .set({
          status: input.status,
          result: input.result ? { ...input.result } : null,
          activeElapsedMs:
            Number(row.activeElapsedMs) +
            Math.max(0, this.now().getTime() - row.phaseStartedAt.getTime()),
          phaseStartedAt: this.now(),
          resultFingerprint: hash,
          resultCursor: input.eventCursor,
          leaseExpiresAt: null,
          completedAt: input.status === "awaiting_clarification" ? null : this.now(),
          errorCategory: input.status === "failed" ? failureCategory(event) : null,
        })
        .where("id", "=", runId)
        .execute();
      let committedVersion = row.baseTripVersion;
      let outcome =
        input.result?.kind === "clarification"
          ? input.result.clarification.question
          : (input.result?.message ?? input.status);
      if (input.result?.kind === "proposal" && row.applicationPolicy === "automatic") {
        // Result receipt, validated mutation, version summary and chat outcome commit
        // together. A domain conflict records a truthful non-application, not a retry loop.
        await sql`SAVEPOINT automatic_proposal`.execute(transaction);
        try {
          const { acceptProposal } = await import("@/domain/trip/accept-proposal");
          const committed = await acceptProposal(
            transaction,
            context.userId,
            row.tripId,
            input.result.proposal.id,
            { requestId: row.requestId, expectedVersion: row.baseTripVersion },
          );
          committedVersion = committed.version;
          const version = await transaction
            .selectFrom("tripVersions")
            .select("changeSummary")
            .where("tripId", "=", row.tripId)
            .where("version", "=", committed.version)
            .executeTakeFirstOrThrow();
          outcome = version.changeSummary.join(" ");
          await sql`RELEASE SAVEPOINT automatic_proposal`.execute(transaction);
        } catch (failure) {
          if (!(failure instanceof ProblemError) || ![409, 422].includes(failure.status))
            throw failure;
          await sql`ROLLBACK TO SAVEPOINT automatic_proposal`.execute(transaction);
          await sql`RELEASE SAVEPOINT automatic_proposal`.execute(transaction);
          outcome =
            "The trip could not be updated because its version, availability or booking state changed. Your saved trip is unchanged. Send your request again to use the latest version.";
          await transaction
            .updateTable("changeProposals")
            .set({ status: "stale" })
            .where("id", "=", input.result.proposal.id)
            .where("status", "=", "proposed")
            .execute();
        }
      } else if (input.result?.kind === "proposal")
        outcome = "A saved proposal is available for review. It has not changed the trip.";
      await transaction
        .insertInto("conversationMessages")
        .values({
          id: randomUUID(),
          conversationId: row.conversationId,
          role: "assistant",
          tripVersion: committedVersion,
          agentRunId: row.id,
          content: { kind: input.status, text: redactConversation(outcome) },
          retentionExpiresAt: rawConversationExpiry(this.now()),
        })
        .execute();
      const constraints = await transaction
        .selectFrom("tripVersions")
        .select("snapshot")
        .where("tripId", "=", row.tripId)
        .where("version", "=", row.baseTripVersion)
        .executeTakeFirstOrThrow();
      const requiredCount = constraints.snapshot.constraints.filter(
        (constraint) => constraint.priority === "required" && constraint.status !== "removed",
      ).length;
      await transaction
        .insertInto("auditEvents")
        .values({
          id: randomUUID(),
          actorType: "service",
          actorId: context.userId,
          action: "estimate.run.result",
          targetType: "agent_run",
          targetId: runId,
          requestId: context.requestId,
          traceId: null,
          outcome: input.status === "failed" ? "failed" : "succeeded",
          metadata: {
            durationMs:
              Number(row.activeElapsedMs) +
              Math.max(0, this.now().getTime() - row.phaseStartedAt.getTime()),
            resultKind: input.status,
            requiredCount,
            accountedCount: input.status === "proposed" ? requiredCount : 0,
          },
        })
        .execute();
      return receipt;
    });
  }
  async events(userId: string, runId: string, after: number): Promise<AgentEvent[]> {
    z.number().int().nonnegative().parse(after);
    await this.read(userId, runId);
    const rows = await this.database
      .selectFrom("agentRunEvents")
      .select("event")
      .where("runId", "=", runId)
      .where("cursor", ">", after)
      .orderBy("cursor")
      .limit(256)
      .execute();
    return rows.map((row) => AgentEventSchema.parse(row.event));
  }
  async resume(userId: string, runId: string, raw: unknown) {
    const input = AnswerClarificationRequestSchema.parse(raw),
      hash = fingerprint(input);
    return inTransaction(this.database, async (transaction) => {
      const row = await this.interrupt(transaction, await this.lock(transaction, userId, runId));
      if (row.planningAccessRevokedAt) throw planningProblems.planningRunAccessRevoked();
      const previous = await transaction
        .selectFrom("agentRunResumes")
        .selectAll()
        .where("runId", "=", runId)
        .where("questionId", "=", input.questionId)
        .executeTakeFirst();
      if (previous) {
        if (previous.fingerprint !== hash) runConflict();
        return { run: envelope(row), replayed: true };
      }
      const result = row.result;
      const trip = await transaction
        .selectFrom("trips")
        .select("currentVersion")
        .where("id", "=", row.tripId)
        .executeTakeFirstOrThrow();
      const clarification = result?.clarification as Record<string, unknown> | undefined;
      if (
        row.status !== "awaiting_clarification" ||
        clarification?.id !== input.questionId ||
        trip.currentVersion !== row.baseTripVersion
      )
        runConflict();
      await transaction
        .insertInto("agentRunResumes")
        .values({
          runId,
          questionId: input.questionId,
          requestId: input.requestId,
          fingerprint: hash,
          eventCursor: row.eventCursor,
        })
        .execute();
      const updated = await transaction
        .updateTable("agentRuns")
        .set({
          status: "running",
          result: null,
          resultFingerprint: null,
          phaseStartedAt: this.now(),
          resultCursor: null,
          leaseExpiresAt: lease(this.now()),
          completedAt: null,
        })
        .where("id", "=", runId)
        .returningAll()
        .executeTakeFirstOrThrow();
      return { run: envelope(updated), replayed: false };
    });
  }
}
