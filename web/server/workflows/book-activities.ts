import { resolveBookingActor } from "@/server/auth/planning-actor";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { bookingTermsSchema, canonicalBookingJson, hashBookingTerms } from "@/domain/booking/authorization";
import { projectBookingTransactionRow, type BookingComponentState, type BookingTransaction } from "@/domain/booking/schema";
import type { Database } from "@/server/db/database";
import { inTransaction } from "@/server/db/transaction";
import { BookingRepository } from "@/server/db/booking-repository";
import { providerForComponent, type TransactionProviderRegistry } from "@/server/supply/transactions";
import { applyBookingOutcome } from "@/domain/booking/apply-outcomes";
import type { BookingWorkflowActivities } from "./booking-contract";

export function createBookingActivities(database: Kysely<Database>, providers: TransactionProviderRegistry) {
  async function load(transactionId: string): Promise<BookingTransaction> {
    const row = await database.selectFrom("bookingTransactions").selectAll().where("id", "=", transactionId).executeTakeFirst();
    if (!row) throw new Error("Booking transaction not found");
    return projectBookingTransactionRow(row);
  }

  return {
    async loadBookingTransaction(transactionId: string) { return load(transactionId); },

    async assertExecutionBasis(transactionId: string, componentId: string) {
      const transaction = await load(transactionId);
      if (transaction.executionStatus !== "active") {
        throw new Error("Execution basis is invalid or expired");
      }
      if (Date.parse(transaction.executionBasis.expiresAt) <= Date.now()) {
        await database.updateTable("bookingTransactions").set({ executionStatus: "expired", status: "action_required" })
          .where("id", "=", transaction.id).execute();
        throw new Error("Execution basis has expired");
      }
      if (hashBookingTerms(transaction.executionBasis.terms) !== transaction.executionBasis.termsHash) {
        await database.updateTable("bookingTransactions").set({ executionStatus: "invalidated", status: "action_required" })
          .where("id", "=", transaction.id).execute();
        throw new Error("Execution terms no longer match the authorization hash");
      }
      if (!transaction.components.some((component) => component.componentId === componentId)) throw new Error("Component is outside authorization");
      const actor = await resolveBookingActor(database, transaction.tripId, transaction.executionBasis.ownerUserId);
      const trip = await database.selectFrom("trips").select(["currentVersion", "ownerUserId"])
        .where("id", "=", transaction.tripId).executeTakeFirst();
      if (!trip || trip.ownerUserId !== actor.planningOwnerId) throw new Error("Trip ownership changed");
      if (trip.currentVersion === transaction.lastObservedTripVersion) return;
      const advanced = await database.selectFrom("tripVersions").select(["version", "initiatingActor", "initiatingRequestId"])
        .where("tripId", "=", transaction.tripId).where("version", ">", transaction.lastObservedTripVersion)
        .where("version", "<=", trip.currentVersion).orderBy("version").execute();
      const evidence = await database.selectFrom("bookingVersionEvidence").select(["tripVersion", "transactionId", "materialTermsHash"])
        .where("tripId", "=", transaction.tripId).where("tripVersion", ">", transaction.lastObservedTripVersion)
        .where("tripVersion", "<=", trip.currentVersion).orderBy("tripVersion").execute();
      if (advanced.length !== trip.currentVersion - transaction.lastObservedTripVersion
        || evidence.length !== advanced.length || evidence.some((item) => item.transactionId !== transaction.id
          || item.materialTermsHash !== transaction.executionBasis.termsHash)
        || advanced.some((version) => version.initiatingActor !== "booking_workflow")) {
        await database.updateTable("bookingTransactions").set({ executionStatus: "invalidated" })
          .where("id", "=", transaction.id).execute();
        throw new Error("Trip changed outside this booking transaction");
      }
      await database.updateTable("bookingTransactions").set({ lastObservedTripVersion: trip.currentVersion })
        .where("id", "=", transaction.id).execute();
    },

    async claimProviderWrite(transactionId: string, componentId: string) {
      const transaction = await load(transactionId);
      const terms = transaction.executionBasis.terms.components.find((item) => item.componentId === componentId);
      if (!terms) throw new Error("Authorized terms do not include this component");
      const idempotencyKey = `${transaction.id}:${componentId}:${transaction.operation}:${transaction.executionBasis.termsHash}`;
      const requestFingerprint = createHash("sha256").update(canonicalBookingJson({ operation: transaction.operation, terms })).digest("hex");
      const attemptId = randomUUID();
      const claimed = await inTransaction(database, async (dbtx) => {
        const repo = new BookingRepository(dbtx);
        const existingAttempt = await dbtx.selectFrom("bookingComponentAttempts").select(["requestFingerprint"])
          .where("operation", "=", transaction.operation).where("idempotencyKey", "=", idempotencyKey)
          .forUpdate().executeTakeFirst();
        if (existingAttempt) {
          if (existingAttempt.requestFingerprint !== requestFingerprint) throw new Error("Provider idempotency key fingerprint conflict");
          return false;
        }
        const current = await dbtx.selectFrom("bookingTransactions").select(["lastObservedTripVersion", "executionBasis"])
          .where("id", "=", transactionId).executeTakeFirst();
        if (!current) return false;
        const basis = current.executionBasis as BookingTransaction["executionBasis"];
        await dbtx.insertInto("bookingComponentAttempts").values({ id: attemptId, transactionId, tripId: transaction.tripId,
          componentId, operation: transaction.operation, idempotencyKey, requestFingerprint, providerAttempt: 1,
          status: "claimed", providerReference: null, safeReason: null, statusCheckedAt: null }).execute();
        return repo.claimComponentWrite({ tripId: transaction.tripId, componentId,
          transactionId, attemptId, expectedVersion: current.lastObservedTripVersion,
          expiresAt: new Date(basis.expiresAt), now: new Date() });
      });
      return { allowed: claimed, idempotencyKey, requestFingerprint };
    },

    async executeProviderWrite(transactionId: string, componentId: string, idempotencyKey: string, requestFingerprint: string): Promise<BookingComponentState> {
      const transaction = await load(transactionId);
      const terms = transaction.executionBasis.terms.components.find((item) => item.componentId === componentId);
      if (!terms) throw new Error("Authorized terms do not include this component");
      const version = await database.selectFrom("tripVersions").select("snapshot")
        .where("tripId", "=", transaction.tripId).where("version", "=", transaction.executionBasis.startingTripVersion).executeTakeFirst();
      if (!version) throw new Error("Authorized trip snapshot is unavailable");
      const snapshot = (version.snapshot as { components?: Array<{ id: string; type: string }> });
      const component = snapshot.components?.find((item) => item.id === componentId);
      if (!component) throw new Error("Authorized component is missing from trip snapshot");
      const provider = providers.require(providerForComponent(component.type), transaction.operation);
      const operation = transaction.operation === "book_trip" ? provider.execute
        : transaction.operation === "cancel_component" ? provider.cancel : provider.reschedule;
      if (!operation) throw new Error("Provider does not support this authorized operation");
      await database.updateTable("bookingComponentAttempts").set({ status: "dispatched", updatedAt: new Date() })
        .where("transactionId", "=", transactionId).where("componentId", "=", componentId)
        .where("idempotencyKey", "=", idempotencyKey).where("requestFingerprint", "=", requestFingerprint).execute();
      try {
        const result = await operation.call(provider, { operation: transaction.operation, componentId,
          supplierOfferId: terms.supplierOfferId, inventoryId: terms.inventoryId,
          idempotencyKey, requestFingerprint, terms });
        if (result.status === "confirmed") {
          const confirmedTerms = bookingTermsSchema.shape.components.element.parse(result.confirmedTerms);
          if (canonicalBookingJson(confirmedTerms) !== canonicalBookingJson(terms)
            || !result.evidenceId || !result.providerReference) {
            await database.updateTable("bookingTransactions").set({ executionStatus: "invalidated", status: "action_required" })
              .where("id", "=", transactionId).execute();
            await database.updateTable("bookingWriteClaims").set({ state: "unknown", updatedAt: new Date() })
              .where("tripId", "=", transaction.tripId).where("componentId", "=", componentId)
              .where("transactionId", "=", transactionId).execute();
            return { componentId, status: "action_required", providerReference: null,
              safeReason: "Supplier confirmed terms that differ from the authorized terms. Review and authorize again." };
          }
        }
        const status: BookingComponentState["status"] = result.status === "confirmed" ? "confirmed" : result.status;
        const outcome: BookingComponentState = { componentId, status,
          providerReference: result.status === "confirmed" ? result.providerReference : null,
          safeReason: result.status === "confirmed" ? null : result.safeReason.slice(0, 500) };
        const persistedStatus = status === "action_required" ? "unknown" : status;
        await database.updateTable("bookingComponentAttempts").set({ status: persistedStatus,
          providerReference: outcome.providerReference, safeReason: outcome.safeReason, updatedAt: new Date() })
          .where("transactionId", "=", transactionId).where("componentId", "=", componentId)
          .where("idempotencyKey", "=", idempotencyKey).execute();
        if (result.status === "unknown" || status === "action_required") {
          await inTransaction(database, (dbtx) => new BookingRepository(dbtx).retainUnknownClaim({ tripId: transaction.tripId, componentId,
            transactionId, evidence: { attemptIdempotencyKey: idempotencyKey }, now: new Date() }));
        } else {
          await inTransaction(database, (dbtx) => new BookingRepository(dbtx).releaseResolvedClaim(transaction.tripId, componentId, transactionId));
        }
        if (result.status === "confirmed") {
          await database.insertInto("bookingConfirmations").values({ id: randomUUID(), transactionId, tripId: transaction.tripId,
            componentId, providerReference: result.providerReference, terms: terms, confirmedAt: new Date() })
            .onConflict((conflict) => conflict.columns(["transactionId", "componentId"]).doNothing()).execute();
        }
        return outcome;
      } catch {
        await database.updateTable("bookingComponentAttempts").set({ status: "unknown", safeReason: "Provider outcome needs status reconciliation.", updatedAt: new Date() })
          .where("transactionId", "=", transactionId).where("componentId", "=", componentId)
          .where("idempotencyKey", "=", idempotencyKey).execute();
        await database.updateTable("bookingWriteClaims").set({ state: "unknown", updatedAt: new Date() })
          .where("tripId", "=", transaction.tripId).where("componentId", "=", componentId)
          .where("transactionId", "=", transactionId).execute();
        return { componentId, status: "unknown", providerReference: null, safeReason: "Provider outcome needs status reconciliation." };
      }
    },

    async recordBookingOutcome(transactionId: string, outcome: BookingComponentState) {
      // An invalidated or expired basis keeps its durable action-required state; the
      // trip version it was authorized against no longer accepts booking outcomes.
      const row = await database.selectFrom("bookingTransactions").select("executionStatus")
        .where("id", "=", transactionId).executeTakeFirst();
      if (!row || row.executionStatus !== "active") return;
      await applyBookingOutcome(database, transactionId, outcome);
    },

    async reconcileProviderStatus(transactionId: string, componentId: string): Promise<BookingComponentState> {
      const transaction = await load(transactionId);
      const terms = transaction.executionBasis.terms.components.find((item) => item.componentId === componentId);
      const snapshotRow = await database.selectFrom("tripVersions").select("snapshot")
        .where("tripId", "=", transaction.tripId).where("version", "=", transaction.executionBasis.startingTripVersion).executeTakeFirst();
      const component = (snapshotRow?.snapshot as { components?: Array<{ id: string; type: string }> } | undefined)?.components?.find((item) => item.id === componentId);
      if (!terms || !component) throw new Error("Booking component cannot be reconciled");
      const provider = providers.require(providerForComponent(component.type), transaction.operation);
      if (!provider.getStatus) return { componentId, status: "action_required", providerReference: null,
        safeReason: "This provider requires manual status confirmation." };
      const key = `${transaction.id}:${componentId}:${transaction.operation}:${transaction.executionBasis.termsHash}`;
      const result = await provider.getStatus(key);
      if (result.status === "confirmed") {
        const confirmedTerms = bookingTermsSchema.shape.components.element.parse(result.confirmedTerms);
        if (!result.providerReference || !result.evidenceId
          || canonicalBookingJson(confirmedTerms) !== canonicalBookingJson(terms)) {
          await database.updateTable("bookingTransactions").set({ executionStatus: "invalidated", status: "action_required" })
            .where("id", "=", transactionId).execute();
          await database.updateTable("bookingWriteClaims").set({ state: "unknown", updatedAt: new Date() })
            .where("tripId", "=", transaction.tripId).where("componentId", "=", componentId)
            .where("transactionId", "=", transactionId).execute();
          return { componentId, status: "action_required", providerReference: null,
            safeReason: "Reconciled provider terms differ from the authorized terms." };
        }
        await inTransaction(database, (dbtx) => new BookingRepository(dbtx).releaseResolvedClaim(transaction.tripId, componentId, transactionId));
        await database.updateTable("bookingComponentAttempts").set({ status: "reconciled", providerReference: result.providerReference,
          statusCheckedAt: new Date(), updatedAt: new Date() }).where("transactionId", "=", transactionId)
          .where("componentId", "=", componentId).where("idempotencyKey", "=", key).execute();
        await database.insertInto("bookingConfirmations").values({ id: randomUUID(), transactionId, tripId: transaction.tripId,
          componentId, providerReference: result.providerReference, terms, confirmedAt: new Date() })
          .onConflict((conflict) => conflict.columns(["transactionId", "componentId"]).doNothing()).execute();
        return { componentId, status: "confirmed", providerReference: result.providerReference, safeReason: null };
      }
      if (result.status === "failed") {
        await inTransaction(database, (dbtx) => new BookingRepository(dbtx).releaseResolvedClaim(transaction.tripId, componentId, transactionId));
        return { componentId, status: "failed", providerReference: null, safeReason: result.safeReason.slice(0, 500) };
      }
      return { componentId, status: result.status === "action_required" ? "action_required" : "unknown",
        providerReference: null, safeReason: result.safeReason.slice(0, 500) };
    },
  } satisfies Omit<BookingWorkflowActivities, "revalidateBooking" | "revalidateComponentReschedule">;
}
