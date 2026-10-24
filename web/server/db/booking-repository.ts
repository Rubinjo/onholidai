import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { sql, type Transaction } from "kysely";
import { z } from "zod";

import {
  bookingComponentTermsSchema,
  bookingTermsV2ComponentSchema,
  canonicalBookingJson,
} from "@/domain/booking/authorization";
import { executionBasisSchema, projectBookingTransactionRow } from "@/domain/booking/schema";
import { applyBookingOutcome } from "@/domain/booking/apply-outcomes";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { ProblemError } from "@/server/errors";
import { lockBookingEvidenceTrip } from "@/server/auth/booking-access";

import type { Database } from "@/server/db/database";
import type { BookingAuthorization, BookingTermsV2 } from "@/domain/booking/authorization";
import type { BookingTransaction } from "@/domain/booking/schema";
import type { TransactionOutcome } from "@/server/supply/transactions";

export class BookingRepository {
  constructor(private readonly transaction: Transaction<Database>) {}

  async wholeTripLineage(tripId: string, ownerUserId: string, now = new Date()) {
    const outstanding = await this.transaction
      .selectFrom("bookingWriteClaims")
      .select("attemptId")
      .where("tripId", "=", tripId)
      .executeTakeFirst();
    const unresolved = await this.transaction
      .selectFrom("bookingComponentAttempts")
      .select("id")
      .where("tripId", "=", tripId)
      .where((expression) =>
        expression.or([
          expression("status", "in", ["dispatched", "unknown"]),
          expression("evidenceConflict", "=", true),
        ]),
      )
      .executeTakeFirst();
    const running = await this.transaction
      .selectFrom("bookingTransactions")
      .select("id")
      .where("tripId", "=", tripId)
      .where("executionStatus", "=", "active")
      .where("completedAt", "is", null)
      .where("status", "in", ["requested", "running", "partially_confirmed"])
      .where(sql<boolean>`(execution_basis->>'expiresAt')::timestamptz > ${now}`)
      .executeTakeFirst();
    if (outstanding || unresolved || running)
      throw new ProblemError({
        title: "Reconcile the existing booking before continuing",
        status: 409,
        code: "booking_continuation_blocked",
        detail:
          "An existing action is running or may have committed. Check its status or contact support before reviewing another whole-trip attempt.",
      });
    const parent = await this.transaction
      .selectFrom("bookingTransactions")
      .select(["id", "rootAttemptId"])
      .where("tripId", "=", tripId)
      .where("ownerUserId", "=", ownerUserId)
      .where("operation", "=", "book_trip")
      .where(
        "id",
        "not in",
        this.transaction
          .selectFrom("bookingTransactions")
          .select("continuationOf")
          .where("tripId", "=", tripId)
          .where("continuationOf", "is not", null),
      )
      .orderBy("startedAt", "desc")
      .orderBy("id", "desc")
      .limit(1)
      .forUpdate()
      .executeTakeFirst();
    return {
      continuationOf: parent?.id ?? null,
      rootAttemptId: parent ? (parent.rootAttemptId ?? parent.id) : null,
    };
  }

  async assertWholeTripLineage(
    tripId: string,
    ownerUserId: string,
    terms: BookingTermsV2,
    now = new Date(),
  ) {
    const lineage = await this.wholeTripLineage(tripId, ownerUserId, now);
    if (
      terms.continuationOf !== lineage.continuationOf ||
      terms.rootAttemptId !== lineage.rootAttemptId
    )
      throw new ProblemError({
        title: "Booking recovery history changed",
        status: 409,
        code: "booking_continuation_changed",
        detail: "Refresh the complete remaining-trip review before authorizing another attempt.",
      });
  }

  async reviewRecords(tripId: string, ownerUserId: string, tripVersion: number) {
    const [review, authorization, history, active, confirmations] = await Promise.all([
      this.transaction
        .selectFrom("bookingRevalidations")
        .selectAll()
        .where("tripId", "=", tripId)
        .where("ownerUserId", "=", ownerUserId)
        .orderBy("createdAt", "desc")
        .orderBy("workflowId", "desc")
        .limit(1)
        .executeTakeFirst(),
      this.transaction
        .selectFrom("bookingAuthorizations")
        .selectAll()
        .where("tripId", "=", tripId)
        .where("ownerUserId", "=", ownerUserId)
        .where("tripVersion", "=", tripVersion)
        .orderBy("createdAt", "desc")
        .orderBy("authorizedAt", "desc")
        .limit(1)
        .executeTakeFirst(),
      this.transaction
        .selectFrom("bookingTransactions")
        .selectAll()
        .where("tripId", "=", tripId)
        .where("ownerUserId", "=", ownerUserId)
        .orderBy("startedAt", "desc")
        .orderBy("id", "desc")
        .limit(10)
        .execute(),
      this.transaction
        .selectFrom("bookingTransactions")
        .selectAll()
        .where("tripId", "=", tripId)
        .where("ownerUserId", "=", ownerUserId)
        .where("executionStatus", "=", "active")
        .where("status", "in", ["requested", "running", "partially_confirmed", "action_required"])
        .orderBy("startedAt", "desc")
        .limit(1)
        .executeTakeFirst(),
      this.transaction
        .selectFrom("bookingConfirmations")
        .selectAll()
        .distinctOn("componentId")
        .where("tripId", "=", tripId)
        .orderBy("componentId")
        .orderBy("confirmedAt", "desc")
        .limit(32)
        .execute(),
    ]);
    const transactionIds = [
      ...new Set([...history.map((entry) => entry.id), ...(active ? [active.id] : [])]),
    ];
    const dispatched = transactionIds.length
      ? await this.transaction
          .selectFrom("bookingComponentAttempts")
          .select(["transactionId", "componentId"])
          .distinctOn(["transactionId", "componentId"])
          .where("transactionId", "in", transactionIds)
          .where("status", "!=", "claimed")
          .limit(352)
          .execute()
      : [];
    return { review, authorization, history, active, confirmations, dispatched };
  }

  async assertConfirmedBasis(tripId: string, terms: BookingTermsV2): Promise<void> {
    const mismatch = () =>
      new ProblemError({
        title: "Confirmed commitment does not match this review",
        status: 409,
        code: "booking_commitment_mismatch",
        detail:
          "Refresh the whole-trip review without replacing or repeating existing commitments.",
      });
    const confirmedIds = new Set(
      terms.components
        .filter((entry) => entry.disposition === "already_confirmed")
        .map((entry) => entry.componentId),
    );
    const durable = await this.transaction
      .selectFrom("bookingConfirmations")
      .select("componentId")
      .where("tripId", "=", tripId)
      .execute();
    if (durable.some((entry) => !confirmedIds.has(entry.componentId))) throw mismatch();
    for (const component of terms.components.filter(
      (entry) => entry.disposition === "already_confirmed",
    )) {
      if (!z.uuid().safeParse(component.confirmationId).success) throw mismatch();
      const saved = await this.transaction
        .selectFrom("bookingConfirmations")
        .innerJoin(
          "bookingTransactions",
          "bookingTransactions.id",
          "bookingConfirmations.transactionId",
        )
        .select(["bookingConfirmations.terms", "bookingTransactions.executionBasis"])
        .where("bookingConfirmations.tripId", "=", tripId)
        .where("bookingConfirmations.componentId", "=", component.componentId)
        .where("bookingConfirmations.id", "=", component.confirmationId)
        .executeTakeFirst();
      if (!saved) throw mismatch();
      const confirmed = bookingComponentTermsSchema.parse(saved.terms);
      let provider: string | undefined = "provider" in confirmed ? confirmed.provider : undefined;
      if (!provider) {
        const basis = executionBasisSchema.parse(saved.executionBasis);
        const version = await this.transaction
          .selectFrom("tripVersions")
          .select("snapshot")
          .where("tripId", "=", tripId)
          .where("version", "=", basis.startingTripVersion)
          .executeTakeFirst();
        provider = version
          ? tripSnapshotSchema
              .parse(version.snapshot)
              .components.find((entry) => entry.id === component.componentId)?.provider
          : undefined;
      }
      if (
        provider !== component.provider ||
        confirmed.supplierOfferId !== component.supplierOfferId ||
        confirmed.inventoryId !== component.inventoryId ||
        confirmed.serviceStart !== component.serviceStart ||
        confirmed.serviceEnd !== component.serviceEnd ||
        confirmed.currency !== component.currency ||
        confirmed.finalCustomerMinor !== component.finalCustomerMinor ||
        confirmed.taxesMinor !== component.taxesMinor ||
        confirmed.feesMinor !== component.feesMinor ||
        confirmed.nonReversible !== component.nonReversible ||
        confirmed.cancellationTerms !== component.cancellationTerms ||
        ("service" in confirmed &&
          canonicalBookingJson(confirmed.service) !== canonicalBookingJson(component.service)) ||
        canonicalBookingJson([...confirmed.travellerIds].sort()) !==
          canonicalBookingJson([...component.travellerIds].sort())
      )
        throw mismatch();
    }
  }

  async insertAuthorization(
    authorization: BookingAuthorization,
    identity?: { requestId: string; requestFingerprint: string },
  ): Promise<void> {
    await this.transaction
      .insertInto("bookingAuthorizations")
      .values({
        id: authorization.id,
        requestId: identity?.requestId ?? null,
        requestFingerprint: identity?.requestFingerprint ?? null,
        tripId: authorization.tripId,
        ownerUserId: authorization.userId,
        tripVersion: authorization.tripVersion,
        operation: authorization.operation,
        componentId: authorization.componentId,
        terms: authorization.terms,
        termsHash: authorization.termsHash,
        acknowledgedNonReversibleActions: sql<
          string[]
        >`${JSON.stringify(authorization.acknowledgedNonReversibleActions)}::jsonb`,
        status: authorization.status,
        reason: authorization.reason,
        authorizedAt: new Date(authorization.authorizedAt),
        expiresAt: new Date(authorization.expiresAt),
      })
      .execute();
  }

  async getAuthorizationForUpdate(id: string, tripId: string, ownerUserId: string) {
    return this.transaction
      .selectFrom("bookingAuthorizations")
      .selectAll()
      .where("id", "=", id)
      .where("tripId", "=", tripId)
      .where("ownerUserId", "=", ownerUserId)
      .forUpdate()
      .executeTakeFirst();
  }

  async startTransaction(input: {
    transaction: BookingTransaction;
    ownerUserId: string;
  }): Promise<boolean> {
    const { transaction, ownerUserId } = input;
    const consumed = await this.transaction
      .updateTable("bookingAuthorizations")
      .set({ status: "consumed" })
      .where("id", "=", transaction.authorizationId)
      .where("tripId", "=", transaction.tripId)
      .where("ownerUserId", "=", ownerUserId)
      .where("tripVersion", "=", transaction.executionBasis.startingTripVersion)
      .where("termsHash", "=", transaction.executionBasis.termsHash)
      .where("status", "=", "authorized")
      .where("expiresAt", ">", new Date(transaction.startedAt))
      .executeTakeFirst();
    if (Number(consumed.numUpdatedRows) !== 1) return false;

    await this.transaction
      .insertInto("bookingTransactions")
      .values({
        id: transaction.id,
        tripId: transaction.tripId,
        ownerUserId,
        authorizationId: transaction.authorizationId,
        operation: transaction.operation,
        workflowId: transaction.workflowId,
        requestId: transaction.requestId,
        status: transaction.status,
        components: sql<unknown[]>`${JSON.stringify(transaction.components)}::jsonb`,
        executionBasis: transaction.executionBasis,
        lastObservedTripVersion: transaction.lastObservedTripVersion,
        executionStatus: transaction.executionStatus,
        startedAt: new Date(transaction.startedAt),
        completedAt: null,
      })
      .execute();
    return true;
  }

  async claimComponentWrite(input: {
    tripId: string;
    componentId: string;
    transactionId: string;
    attemptId: string;
    expectedVersion: number;
    expiresAt: Date;
    now: Date;
    requirementIds?: string[];
    operation: BookingTransaction["operation"];
    idempotencyKey: string;
    requestFingerprint: string;
  }): Promise<boolean> {
    const trip = await this.transaction
      .selectFrom("trips")
      .select(["currentVersion"])
      .where("id", "=", input.tripId)
      .forUpdate()
      .executeTakeFirst();
    const transaction = await this.transaction
      .selectFrom("bookingTransactions")
      .select(["lastObservedTripVersion", "executionStatus", "executionBasis", "operation"])
      .where("id", "=", input.transactionId)
      .where("tripId", "=", input.tripId)
      .forUpdate()
      .executeTakeFirst();
    if (
      !trip ||
      !transaction ||
      transaction.executionStatus !== "active" ||
      trip.currentVersion !== input.expectedVersion ||
      transaction.lastObservedTripVersion !== input.expectedVersion ||
      input.expiresAt <= input.now
    )
      return false;
    const basis = executionBasisSchema.parse(transaction.executionBasis);
    const component = basis.terms.components.find(
      (entry) => entry.componentId === input.componentId,
    );
    if (
      !component ||
      transaction.operation !== input.operation ||
      input.idempotencyKey !==
        `${input.transactionId}:${input.componentId}:${input.operation}:${basis.termsHash}` ||
      input.requestFingerprint !==
        createHash("sha256")
          .update(canonicalBookingJson({ operation: input.operation, terms: component }))
          .digest("hex") ||
      input.expiresAt.getTime() !== Date.parse(basis.expiresAt)
    )
      throw new Error("Provider claim does not match its immutable execution basis");
    const wholeTripComponent = bookingTermsV2ComponentSchema.safeParse(component);
    const requirementIds = wholeTripComponent.success
      ? wholeTripComponent.data.evidence.requirementIds
      : [];
    if (canonicalBookingJson(input.requirementIds ?? []) !== canonicalBookingJson(requirementIds))
      throw new Error("Provider claim requirements do not match the authorized component");
    if (
      input.operation === "book_trip" &&
      wholeTripComponent.success &&
      wholeTripComponent.data.disposition !== "to_book"
    )
      return false;
    const commitments = await this.transaction
      .selectFrom("bookingConfirmations")
      .select(["componentId", "terms"])
      .where("tripId", "=", input.tripId)
      .execute();
    if (
      input.operation === "book_trip" &&
      commitments.some((saved) => {
        const confirmed = bookingTermsV2ComponentSchema.safeParse(saved.terms);
        return (
          saved.componentId === input.componentId ||
          (confirmed.success &&
            confirmed.data.evidence.requirementIds.some((id) => requirementIds.includes(id)))
        );
      })
    )
      return false;
    if (input.requirementIds?.length) {
      const overlapping = await this.transaction
        .selectFrom("bookingWriteClaims")
        .innerJoin(
          "bookingComponentAttempts",
          "bookingComponentAttempts.id",
          "bookingWriteClaims.attemptId",
        )
        .select("bookingWriteClaims.componentId")
        .where("bookingWriteClaims.tripId", "=", input.tripId)
        .where(sql<boolean>`requirement_ids && ${input.requirementIds}::text[]`)
        .executeTakeFirst();
      if (overlapping) return false;
    }
    const priorClaim = await this.transaction
      .selectFrom("bookingWriteClaims")
      .select("attemptId")
      .where("tripId", "=", input.tripId)
      .where("componentId", "=", input.componentId)
      .executeTakeFirst();
    if (priorClaim) return false;
    await this.transaction
      .insertInto("bookingComponentAttempts")
      .values({
        id: input.attemptId,
        transactionId: input.transactionId,
        tripId: input.tripId,
        componentId: input.componentId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        requirementIds: input.requirementIds ?? [],
        providerAttempt: 1,
        status: "claimed",
        providerReference: null,
        safeReason: null,
        statusCheckedAt: null,
      })
      .execute();
    const inserted = await this.transaction
      .insertInto("bookingWriteClaims")
      .values({
        tripId: input.tripId,
        componentId: input.componentId,
        transactionId: input.transactionId,
        attemptId: input.attemptId,
        state: "claimed",
        evidence: null,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning("tripId")
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async releaseResolvedClaim(
    tripId: string,
    componentId: string,
    transactionId: string,
  ): Promise<void> {
    await this.transaction
      .deleteFrom("bookingWriteClaims")
      .where("tripId", "=", tripId)
      .where("componentId", "=", componentId)
      .where("transactionId", "=", transactionId)
      .execute();
  }

  async releaseUndispatchedClaims(transactionId: string, componentId?: string): Promise<void> {
    let removal = this.transaction
      .deleteFrom("bookingWriteClaims")
      .where("transactionId", "=", transactionId)
      .where("state", "=", "claimed")
      .where(
        "attemptId",
        "in",
        this.transaction
          .selectFrom("bookingComponentAttempts")
          .select("id")
          .where("transactionId", "=", transactionId)
          .where("status", "=", "claimed"),
      );
    if (componentId) removal = removal.where("componentId", "=", componentId);
    await removal.execute();
  }

  async recordProviderEvidence(input: {
    transactionId: string;
    componentId: string;
    idempotencyKey: string;
    result: TransactionOutcome;
    reconciled: boolean;
    now: Date;
  }) {
    const identity = await this.transaction
      .selectFrom("bookingTransactions")
      .select("tripId")
      .where("id", "=", input.transactionId)
      .executeTakeFirstOrThrow();
    await lockBookingEvidenceTrip(this.transaction, identity.tripId);
    const row = await this.transaction
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", input.transactionId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const booking = projectBookingTransactionRow(row);
    const authorized = booking.executionBasis.terms.components.find(
      (entry) => entry.componentId === input.componentId,
    );
    if (!authorized) throw new Error("Provider evidence is outside the authorized component set");
    let attempt = await this.transaction
      .selectFrom("bookingComponentAttempts")
      .selectAll()
      .where("transactionId", "=", input.transactionId)
      .where("componentId", "=", input.componentId)
      .where("idempotencyKey", "=", input.idempotencyKey)
      .forUpdate()
      .executeTakeFirst();
    const existing = await this.transaction
      .selectFrom("bookingConfirmations")
      .select(["id", "providerReference", "terms"])
      .where("transactionId", "=", input.transactionId)
      .where("componentId", "=", input.componentId)
      .executeTakeFirst();
    if (!attempt && existing) {
      if (
        input.idempotencyKey !==
        `${booking.id}:${input.componentId}:${booking.operation}:${booking.executionBasis.termsHash}`
      )
        throw new Error("Historical status evidence does not match the saved booking identity");
      attempt = await this.transaction
        .insertInto("bookingComponentAttempts")
        .values({
          id: randomUUID(),
          transactionId: booking.id,
          tripId: booking.tripId,
          componentId: input.componentId,
          operation: booking.operation,
          idempotencyKey: input.idempotencyKey,
          requestFingerprint: createHash("sha256")
            .update(canonicalBookingJson({ operation: booking.operation, terms: authorized }))
            .digest("hex"),
          providerAttempt: 1,
          status: "reconciled",
          providerReference: existing.providerReference,
          safeReason: "Historical confirmation status reconciliation.",
          statusCheckedAt: input.now,
          requirementIds: bookingTermsV2ComponentSchema.safeParse(authorized).success
            ? bookingTermsV2ComponentSchema.parse(authorized).evidence.requirementIds
            : [],
          providerEvidence: sql<unknown[]>`${JSON.stringify([
            {
              status: "confirmed",
              providerReference: existing.providerReference,
              evidenceId: existing.id,
              terms: bookingComponentTermsSchema.parse(existing.terms),
            },
          ])}::jsonb`,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    if (!attempt || (attempt.status === "claimed" && !existing))
      throw new Error("Provider evidence requires a dispatched attempt or saved confirmation");
    const result = input.result;
    const parsedTerms =
      result.status === "confirmed"
        ? bookingComponentTermsSchema.safeParse(result.confirmedTerms)
        : null;
    const terms = parsedTerms?.success ? parsedTerms.data : null;
    const priorReference = existing?.providerReference ?? attempt.providerReference;
    const conflict =
      attempt.evidenceConflict ||
      Boolean(
        priorReference &&
        (result.status !== "confirmed" ||
          priorReference !== result.providerReference ||
          (existing && canonicalBookingJson(existing.terms) !== canonicalBookingJson(terms))),
      );
    const changed =
      result.status === "confirmed" &&
      (!terms || canonicalBookingJson(terms) !== canonicalBookingJson(authorized));
    const evidence =
      result.status === "confirmed"
        ? {
            status: result.status,
            providerReference: result.providerReference,
            evidenceId: result.evidenceId,
            terms,
          }
        : { status: result.status };
    const evidenceHistory = attempt.providerEvidence;
    if (
      !evidenceHistory.some(
        (saved) => canonicalBookingJson(saved) === canonicalBookingJson(evidence),
      )
    )
      evidenceHistory.push(evidence);
    const status = conflict || changed ? "action_required" : result.status;
    const outcome = {
      componentId: input.componentId,
      status,
      providerReference:
        priorReference ?? (result.status === "confirmed" ? result.providerReference : null),
      safeReason: conflict
        ? "Contradictory supplier evidence requires support. Existing confirmation evidence is preserved."
        : changed
          ? "The supplier confirmed changed terms. The commitment is preserved; contact support before continuing."
          : result.status === "confirmed"
            ? null
            : result.safeReason.slice(0, 500),
    };
    if (result.status === "confirmed" && terms && !existing)
      await this.transaction
        .insertInto("bookingConfirmations")
        .values({
          id: randomUUID(),
          transactionId: booking.id,
          tripId: booking.tripId,
          componentId: input.componentId,
          providerReference: result.providerReference,
          terms,
          confirmedAt: input.now,
        })
        .execute();
    await this.transaction
      .updateTable("bookingComponentAttempts")
      .set({
        status:
          status === "action_required"
            ? "unknown"
            : input.reconciled && status === "confirmed"
              ? "reconciled"
              : status,
        providerReference: outcome.providerReference,
        safeReason: outcome.safeReason,
        providerEvidence: sql<unknown[]>`${JSON.stringify(evidenceHistory)}::jsonb`,
        evidenceConflict: conflict,
        ...(input.reconciled ? { statusCheckedAt: input.now } : {}),
        updatedAt: input.now,
      })
      .where("id", "=", attempt.id)
      .execute();
    if (status === "confirmed" || status === "failed")
      await this.releaseResolvedClaim(booking.tripId, input.componentId, booking.id);
    else
      await this.retainUnknownClaim({
        tripId: booking.tripId,
        componentId: input.componentId,
        transactionId: booking.id,
        evidence: { attemptIdempotencyKey: input.idempotencyKey, evidenceConflict: conflict },
        now: input.now,
      });
    await applyBookingOutcome(this.transaction, booking.id, outcome, input.now);
    return outcome;
  }

  async retainUnknownClaim(input: {
    tripId: string;
    componentId: string;
    transactionId: string;
    evidence: Record<string, unknown>;
    now: Date;
  }): Promise<void> {
    await this.transaction
      .updateTable("bookingWriteClaims")
      .set({ state: "unknown", evidence: input.evidence, updatedAt: input.now })
      .where("tripId", "=", input.tripId)
      .where("componentId", "=", input.componentId)
      .where("transactionId", "=", input.transactionId)
      .execute();
  }
}
