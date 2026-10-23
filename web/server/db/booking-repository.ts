import "server-only";

import { sql, type Transaction } from "kysely";
import { z } from "zod";

import { bookingComponentTermsSchema, canonicalBookingJson } from "@/domain/booking/authorization";
import { executionBasisSchema } from "@/domain/booking/schema";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { ProblemError } from "@/server/errors";

import type { Database } from "@/server/db/database";
import type { BookingAuthorization, BookingTermsV2 } from "@/domain/booking/authorization";
import type { BookingTransaction } from "@/domain/booking/schema";

export class BookingRepository {
  constructor(private readonly transaction: Transaction<Database>) {}

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
    for (const component of terms.components.filter(
      (entry) => entry.disposition === "already_confirmed",
    )) {
      const mismatch = () =>
        new ProblemError({
          title: "Confirmed commitment does not match this review",
          status: 409,
          code: "booking_commitment_mismatch",
          detail:
            "Refresh the whole-trip review without replacing or repeating existing commitments.",
        });
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
        confirmed.cancellationTerms !== component.cancellationTerms ||
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
  }): Promise<boolean> {
    const trip = await this.transaction
      .selectFrom("trips")
      .select(["currentVersion"])
      .where("id", "=", input.tripId)
      .forUpdate()
      .executeTakeFirst();
    const transaction = await this.transaction
      .selectFrom("bookingTransactions")
      .select(["lastObservedTripVersion", "executionStatus"])
      .where("id", "=", input.transactionId)
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
      .onConflict((conflict) => conflict.columns(["tripId", "componentId"]).doNothing())
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
