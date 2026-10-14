import "server-only";

import type { Transaction } from "kysely";
import type { Database } from "@/server/db/database";
import type { BookingAuthorization } from "@/domain/booking/authorization";
import type { BookingTransaction } from "@/domain/booking/schema";

export class BookingRepository {
  constructor(private readonly transaction: Transaction<Database>) {}

  async insertAuthorization(authorization: BookingAuthorization): Promise<void> {
    await this.transaction.insertInto("bookingAuthorizations").values({
      id: authorization.id, tripId: authorization.tripId, ownerUserId: authorization.userId,
      tripVersion: authorization.tripVersion, operation: authorization.operation, componentId: authorization.componentId,
      terms: authorization.terms, termsHash: authorization.termsHash,
      acknowledgedNonReversibleActions: authorization.acknowledgedNonReversibleActions,
      status: authorization.status, reason: authorization.reason,
      authorizedAt: new Date(authorization.authorizedAt), expiresAt: new Date(authorization.expiresAt),
    }).execute();
  }

  async getAuthorizationForUpdate(id: string, tripId: string, ownerUserId: string) {
    return this.transaction.selectFrom("bookingAuthorizations").selectAll()
      .where("id", "=", id).where("tripId", "=", tripId).where("ownerUserId", "=", ownerUserId)
      .forUpdate().executeTakeFirst();
  }

  async startTransaction(input: {
    transaction: BookingTransaction; ownerUserId: string;
  }): Promise<boolean> {
    const { transaction, ownerUserId } = input;
    const consumed = await this.transaction.updateTable("bookingAuthorizations")
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

    await this.transaction.insertInto("bookingTransactions").values({
      id: transaction.id, tripId: transaction.tripId, ownerUserId,
      authorizationId: transaction.authorizationId, operation: transaction.operation,
      workflowId: transaction.workflowId, requestId: transaction.requestId,
      status: transaction.status, components: transaction.components,
      executionBasis: transaction.executionBasis, lastObservedTripVersion: transaction.lastObservedTripVersion,
      executionStatus: transaction.executionStatus, startedAt: new Date(transaction.startedAt), completedAt: null,
    }).execute();
    return true;
  }

  async claimComponentWrite(input: {
    tripId: string; componentId: string; transactionId: string; attemptId: string; expectedVersion: number; expiresAt: Date; now: Date;
  }): Promise<boolean> {
    const trip = await this.transaction.selectFrom("trips").select(["currentVersion"]).where("id", "=", input.tripId)
      .forUpdate().executeTakeFirst();
    const transaction = await this.transaction.selectFrom("bookingTransactions").select(["lastObservedTripVersion", "executionStatus"])
      .where("id", "=", input.transactionId).forUpdate().executeTakeFirst();
    if (!trip || !transaction || transaction.executionStatus !== "active"
      || trip.currentVersion !== input.expectedVersion || transaction.lastObservedTripVersion !== input.expectedVersion
      || input.expiresAt <= input.now) return false;
    const inserted = await this.transaction.insertInto("bookingWriteClaims").values({
      tripId: input.tripId, componentId: input.componentId, transactionId: input.transactionId,
      attemptId: input.attemptId, state: "claimed", evidence: null,
      createdAt: input.now, updatedAt: input.now,
    }).onConflict((conflict) => conflict.columns(["tripId", "componentId"]).doNothing())
      .returning("tripId").executeTakeFirst();
    return inserted !== undefined;
  }

  async releaseResolvedClaim(tripId: string, componentId: string, transactionId: string): Promise<void> {
    await this.transaction.deleteFrom("bookingWriteClaims")
      .where("tripId", "=", tripId).where("componentId", "=", componentId)
      .where("transactionId", "=", transactionId).execute();
  }

  async retainUnknownClaim(input: { tripId: string; componentId: string; transactionId: string; evidence: Record<string, unknown>; now: Date }): Promise<void> {
    await this.transaction.updateTable("bookingWriteClaims")
      .set({ state: "unknown", evidence: input.evidence, updatedAt: input.now })
      .where("tripId", "=", input.tripId).where("componentId", "=", input.componentId)
      .where("transactionId", "=", input.transactionId).execute();
  }
}
