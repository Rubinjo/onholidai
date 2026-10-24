import "server-only";
import { createHash, randomUUID } from "node:crypto";

import { resolveBookingActor } from "@/server/auth/planning-actor";
import { lockBookingEvidenceTrip, lockBookingTrip } from "@/server/auth/booking-access";
import {
  bookingTermsV2ComponentSchema,
  canonicalBookingJson,
  hashBookingTerms,
  isWholeTripTerms,
} from "@/domain/booking/authorization";
import {
  projectBookingTransactionRow,
  type BookingComponentState,
  type BookingTransaction,
} from "@/domain/booking/schema";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { inTransaction } from "@/server/db/transaction";
import { BookingRepository } from "@/server/db/booking-repository";
import {
  providerForComponent,
  type TransactionProviderRegistry,
  type TransactionOutcome,
} from "@/server/supply/transactions";
import { applyBookingOutcome } from "@/domain/booking/apply-outcomes";

import type { Database } from "@/server/db/database";
import type { Kysely, Transaction } from "kysely";
import type { BookingWorkflowActivities } from "./booking-contract";

export function createBookingActivities(
  database: Kysely<Database>,
  providers: TransactionProviderRegistry,
) {
  async function load(transactionId: string): Promise<BookingTransaction> {
    const row = await database
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", transactionId)
      .executeTakeFirstOrThrow();
    return projectBookingTransactionRow(row);
  }

  async function lockBasis(dbtx: Transaction<Database>, transactionId: string) {
    const identity = await dbtx
      .selectFrom("bookingTransactions")
      .select(["tripId", "ownerUserId"])
      .where("id", "=", transactionId)
      .executeTakeFirstOrThrow();
    const actor = await resolveBookingActor(dbtx, identity.tripId, identity.ownerUserId);
    const trip = await lockBookingTrip(dbtx, actor, identity.tripId);
    if (!trip) throw new Error("Trip ownership changed");
    const row = await dbtx
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", transactionId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    return { trip, booking: projectBookingTransactionRow(row) };
  }

  async function checkBasis(
    dbtx: Transaction<Database>,
    locked: Awaited<ReturnType<typeof lockBasis>>,
    componentId: string,
  ) {
    const { booking, trip } = locked;
    if (isWholeTripTerms(booking.executionBasis.terms))
      return "Whole-trip provider execution is not activated";
    if (!booking.components.some((component) => component.componentId === componentId))
      return "Component is outside authorization";
    if (booking.executionStatus !== "active") return "Execution basis is invalid or expired";
    let failure: string | null = null;
    const expired = Date.parse(booking.executionBasis.expiresAt) <= Date.now();
    if (expired) failure = "Execution basis has expired";
    else if (hashBookingTerms(booking.executionBasis.terms) !== booking.executionBasis.termsHash)
      failure = "Execution terms no longer match the authorization hash";
    else if (trip.currentVersion !== booking.lastObservedTripVersion) {
      const advanced = await dbtx
        .selectFrom("tripVersions")
        .select(["version", "initiatingActor"])
        .where("tripId", "=", booking.tripId)
        .where("version", ">", booking.lastObservedTripVersion)
        .where("version", "<=", trip.currentVersion)
        .orderBy("version")
        .execute();
      const evidence = await dbtx
        .selectFrom("bookingVersionEvidence")
        .select(["tripVersion", "transactionId", "materialTermsHash"])
        .where("tripId", "=", booking.tripId)
        .where("tripVersion", ">", booking.lastObservedTripVersion)
        .where("tripVersion", "<=", trip.currentVersion)
        .orderBy("tripVersion")
        .execute();
      if (
        advanced.length !== trip.currentVersion - booking.lastObservedTripVersion ||
        evidence.length !== advanced.length ||
        evidence.some(
          (item) =>
            item.transactionId !== booking.id ||
            item.materialTermsHash !== booking.executionBasis.termsHash,
        ) ||
        advanced.some((version) => version.initiatingActor !== "booking_workflow")
      )
        failure = "Trip changed outside this booking transaction";
      else {
        await dbtx
          .updateTable("bookingTransactions")
          .set({ lastObservedTripVersion: trip.currentVersion })
          .where("id", "=", booking.id)
          .execute();
        booking.lastObservedTripVersion = trip.currentVersion;
      }
    }
    if (failure) {
      await dbtx
        .updateTable("bookingTransactions")
        .set({ executionStatus: expired ? "expired" : "invalidated", status: "action_required" })
        .where("id", "=", booking.id)
        .execute();
      await new BookingRepository(dbtx).releaseUndispatchedClaims(booking.id);
    }
    return failure;
  }

  function requestIdentity(booking: BookingTransaction, componentId: string) {
    const terms = booking.executionBasis.terms.components.find(
      (item) => item.componentId === componentId,
    );
    if (!terms) throw new Error("Authorized terms do not include this component");
    return {
      terms,
      idempotencyKey: `${booking.id}:${componentId}:${booking.operation}:${booking.executionBasis.termsHash}`,
      requestFingerprint: createHash("sha256")
        .update(canonicalBookingJson({ operation: booking.operation, terms }))
        .digest("hex"),
    };
  }

  async function componentProvider(booking: BookingTransaction, componentId: string) {
    const version = await database
      .selectFrom("tripVersions")
      .select("snapshot")
      .where("tripId", "=", booking.tripId)
      .where("version", "=", booking.executionBasis.startingTripVersion)
      .executeTakeFirstOrThrow();
    const component = tripSnapshotSchema
      .parse(version.snapshot)
      .components.find((item) => item.id === componentId);
    if (!component) throw new Error("Authorized component is missing from trip snapshot");
    const terms = booking.executionBasis.terms;
    if (isWholeTripTerms(terms)) {
      const authorized = terms.components.find((entry) => entry.componentId === componentId);
      if (
        !authorized ||
        authorized.provider !== component.provider ||
        authorized.service.type !== component.type
      )
        throw new Error("Provider provenance differs from the immutable authorized product");
    }
    return {
      provider: providerForComponent(component.type, component.provider),
      type: component.type,
    };
  }

  async function record(
    transactionId: string,
    componentId: string,
    idempotencyKey: string,
    result: TransactionOutcome,
    reconciled: boolean,
  ) {
    return inTransaction(database, (dbtx) =>
      new BookingRepository(dbtx).recordProviderEvidence({
        transactionId,
        componentId,
        idempotencyKey,
        result,
        reconciled,
        now: new Date(),
      }),
    );
  }

  return {
    async loadBookingTransaction(transactionId: string) {
      return load(transactionId);
    },

    async assertExecutionBasis(transactionId: string, componentId: string) {
      const failure = await inTransaction(database, async (dbtx) =>
        checkBasis(dbtx, await lockBasis(dbtx, transactionId), componentId),
      );
      if (failure) throw new Error(failure);
    },

    async claimProviderWrite(transactionId: string, componentId: string) {
      const result = await inTransaction(database, async (dbtx) => {
        const locked = await lockBasis(dbtx, transactionId);
        const { booking } = locked;
        const { terms, idempotencyKey, requestFingerprint } = requestIdentity(booking, componentId);
        const failure = await checkBasis(dbtx, locked, componentId);
        if (failure) return { allowed: false, idempotencyKey, requestFingerprint, failure };
        const existing = await dbtx
          .selectFrom("bookingComponentAttempts")
          .select("requestFingerprint")
          .where("operation", "=", booking.operation)
          .where("idempotencyKey", "=", idempotencyKey)
          .forUpdate()
          .executeTakeFirst();
        if (
          existing?.requestFingerprint !== undefined &&
          existing.requestFingerprint !== requestFingerprint
        )
          throw new Error("Provider idempotency key fingerprint conflict");
        if (existing) return { allowed: false, idempotencyKey, requestFingerprint, failure: null };
        const allowed = await new BookingRepository(dbtx).claimComponentWrite({
          tripId: booking.tripId,
          componentId,
          transactionId,
          attemptId: randomUUID(),
          expectedVersion: booking.lastObservedTripVersion,
          expiresAt: new Date(booking.executionBasis.expiresAt),
          now: new Date(),
          operation: booking.operation,
          idempotencyKey,
          requestFingerprint,
          requirementIds: isWholeTripTerms(booking.executionBasis.terms)
            ? bookingTermsV2ComponentSchema.parse(terms).evidence.requirementIds
            : [],
        });
        return { allowed, idempotencyKey, requestFingerprint, failure: null };
      });
      if (result.failure) throw new Error(result.failure);
      return {
        allowed: result.allowed,
        idempotencyKey: result.idempotencyKey,
        requestFingerprint: result.requestFingerprint,
      };
    },

    async executeProviderWrite(
      transactionId: string,
      componentId: string,
      idempotencyKey: string,
      requestFingerprint: string,
    ): Promise<BookingComponentState> {
      const booking = await load(transactionId);
      if (isWholeTripTerms(booking.executionBasis.terms))
        throw new Error("Whole-trip provider execution is not activated");
      const identity = requestIdentity(booking, componentId);
      if (
        identity.idempotencyKey !== idempotencyKey ||
        identity.requestFingerprint !== requestFingerprint
      )
        throw new Error("Provider request does not match the immutable claim");
      const product = await componentProvider(booking, componentId);
      const provider = isWholeTripTerms(booking.executionBasis.terms)
        ? providers.requireCurrent(product, booking.operation)
        : providers.require(product.provider, booking.operation);
      const operation =
        booking.operation === "book_trip"
          ? provider.execute
          : booking.operation === "cancel_component"
            ? provider.cancel
            : provider.reschedule;
      if (!operation) throw new Error("Provider does not support this authorized operation");
      const dispatch = await inTransaction(database, async (dbtx) => {
        const locked = await lockBasis(dbtx, transactionId);
        const failure = await checkBasis(dbtx, locked, componentId);
        if (failure) return { won: false, failure };
        const claim = await dbtx
          .selectFrom("bookingWriteClaims")
          .selectAll()
          .where("tripId", "=", booking.tripId)
          .where("componentId", "=", componentId)
          .where("transactionId", "=", transactionId)
          .forUpdate()
          .executeTakeFirst();
        if (!claim || claim.state !== "claimed") return { won: false, failure: null };
        const updated = await dbtx
          .updateTable("bookingComponentAttempts")
          .set({ status: "dispatched", updatedAt: new Date() })
          .where("id", "=", claim.attemptId)
          .where("transactionId", "=", transactionId)
          .where("componentId", "=", componentId)
          .where("idempotencyKey", "=", idempotencyKey)
          .where("requestFingerprint", "=", requestFingerprint)
          .where("status", "=", "claimed")
          .returning("id")
          .executeTakeFirst();
        return { won: Boolean(updated), failure: null };
      });
      if (dispatch.failure) throw new Error(dispatch.failure);
      if (!dispatch.won) {
        const current = await load(transactionId);
        const outcome = current.components.find((item) => item.componentId === componentId);
        if (
          outcome &&
          ["confirmed", "failed", "unknown", "action_required", "cancelled"].includes(
            outcome.status,
          )
        )
          return outcome;
        throw new Error(
          "Provider dispatch is already in progress; reconcile status instead of retrying",
        );
      }
      let result: TransactionOutcome;
      try {
        result = await operation.call(provider, {
          operation: booking.operation,
          componentId,
          supplierOfferId: identity.terms.supplierOfferId,
          inventoryId: identity.terms.inventoryId,
          idempotencyKey,
          requestFingerprint,
          terms: identity.terms,
        });
      } catch {
        result = { status: "unknown", safeReason: "Provider outcome needs status reconciliation." };
      }
      return record(transactionId, componentId, idempotencyKey, result, false);
    },

    async recordBookingOutcome(transactionId: string, outcome: BookingComponentState) {
      await inTransaction(database, async (transaction) => {
        const identity = await transaction
          .selectFrom("bookingTransactions")
          .select("tripId")
          .where("id", "=", transactionId)
          .executeTakeFirstOrThrow();
        await lockBookingEvidenceTrip(transaction, identity.tripId);
        await transaction
          .selectFrom("bookingTransactions")
          .select("id")
          .where("id", "=", transactionId)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const attempt = await transaction
          .selectFrom("bookingComponentAttempts")
          .select(["id", "status", "providerEvidence"])
          .where("transactionId", "=", transactionId)
          .where("componentId", "=", outcome.componentId)
          .forUpdate()
          .executeTakeFirst();
        if (attempt?.providerEvidence.length) return;
        if (attempt?.status === "claimed")
          await new BookingRepository(transaction).releaseUndispatchedClaims(
            transactionId,
            outcome.componentId,
          );
        await applyBookingOutcome(transaction, transactionId, outcome);
      });
    },

    async reconcileProviderStatus(
      transactionId: string,
      componentId: string,
    ): Promise<BookingComponentState> {
      const booking = await load(transactionId);
      const { idempotencyKey } = requestIdentity(booking, componentId);
      const attempt = await database
        .selectFrom("bookingComponentAttempts")
        .select(["status", "providerReference"])
        .where("transactionId", "=", transactionId)
        .where("componentId", "=", componentId)
        .where("idempotencyKey", "=", idempotencyKey)
        .executeTakeFirst();
      const confirmation = await database
        .selectFrom("bookingConfirmations")
        .select("providerReference")
        .where("transactionId", "=", transactionId)
        .where("componentId", "=", componentId)
        .executeTakeFirst();
      if ((!attempt || attempt.status === "claimed") && !confirmation)
        throw new Error("No dispatched provider action exists to reconcile");
      const adapter = providers.get((await componentProvider(booking, componentId)).provider);
      let result: TransactionOutcome;
      if (!adapter?.capabilities.status || !adapter.getStatus)
        result = {
          status: "action_required",
          safeReason:
            "This provider requires manual status confirmation. Contact support; do not retry.",
        };
      else {
        try {
          result = await adapter.getStatus(idempotencyKey, {
            componentId,
            terms: requestIdentity(booking, componentId).terms,
            providerReference:
              confirmation?.providerReference ?? attempt?.providerReference ?? null,
          });
        } catch {
          result = {
            status: "unknown",
            safeReason: "Provider status is unavailable. Contact support before continuing.",
          };
        }
      }
      return record(transactionId, componentId, idempotencyKey, result, true);
    },
  } satisfies Omit<
    BookingWorkflowActivities,
    "revalidateBooking" | "revalidateComponentReschedule"
  >;
}
