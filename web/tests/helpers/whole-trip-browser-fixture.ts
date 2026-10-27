import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { createDatabase } from "../../server/db/database";
import { authorizeBooking } from "../../domain/booking/authorize";
import { startBooking } from "../../domain/booking/start";
import { readBookingReview, startBookingRevalidation } from "../../domain/booking/revalidate";
import { bookingTermsV2Schema, canonicalBookingJson } from "../../domain/booking/authorization";
import { projectPublicBookingTransaction } from "../../domain/booking/schema";
import { lockBookingEvidenceTrip } from "../../server/auth/booking-access";
import { BookingRepository } from "../../server/db/booking-repository";
import { inTransaction } from "../../server/db/transaction";
import { TransactionProviderRegistry } from "../../server/supply/transactions";
import { createRevalidationActivities } from "../../server/workflows/revalidate-activities";
import { seedReviewedWholeTrip } from "./booking";

import type { TrustedBookingPrerequisiteReader } from "../../server/supply/payment";

const command = z
  .discriminatedUnion("action", [
    z
      .object({ action: z.literal("seed"), ownerUserId: z.string(), incomplete: z.boolean() })
      .strict(),
    z
      .object({
        action: z.enum(["authorize", "start", "review-remainder"]),
        ownerUserId: z.string(),
        tripId: z.uuid(),
        request: z.unknown(),
      })
      .strict(),
    z
      .object({
        action: z.literal("prepare-recovery"),
        ownerUserId: z.string(),
        tripId: z.uuid(),
        outcome: z.enum(["failed", "unknown"]),
      })
      .strict(),
    z.object({ action: z.literal("inspect"), ownerUserId: z.string(), tripId: z.uuid() }).strict(),
  ])
  .parse(JSON.parse(process.argv[2] ?? ""));
const connectionString = process.env.E2E_FIXTURE_DATABASE_URL;
if (!connectionString)
  throw new Error("The browser fixture requires an explicitly isolated database");
const url = new URL(connectionString);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/onholidai_us3_browser")
  throw new Error("The browser fixture is restricted to the disposable local US3 database");
const database = createDatabase({ connectionString });
try {
  let result: unknown;
  if (command.action === "seed") {
    const seeded = await seedReviewedWholeTrip(
      database,
      command.incomplete
        ? (snapshot) => {
            const missing = snapshot.components.find(
              (entry) => entry.planningDetails?.flightDirection === "return",
            )!;
            snapshot.components = snapshot.components.filter((entry) => entry.id !== missing.id);
            snapshot.itineraryDays.forEach((day) =>
              day.items.forEach((item) => {
                if (item.componentId === missing.id) item.componentId = null;
              }),
            );
            snapshot.price.supplierTotal!.minorUnits -= missing.price.supplierAmount!.minorUnits;
            snapshot.price.finalCustomerTotal.minorUnits -=
              missing.price.finalCustomerAmount.minorUnits;
          }
        : undefined,
      "completed",
      command.ownerUserId,
      new Date(),
      command.incomplete ? 0 : 500,
    );
    result = await readBookingReview(database, command.ownerUserId, seeded.tripId);
  } else if (command.action === "inspect") {
    const [review, authorizations, transactions, attempts, outbox] = await Promise.all([
      readBookingReview(database, command.ownerUserId, command.tripId),
      database
        .selectFrom("bookingAuthorizations")
        .select("id")
        .where("tripId", "=", command.tripId)
        .execute(),
      database
        .selectFrom("bookingTransactions")
        .select("id")
        .where("tripId", "=", command.tripId)
        .execute(),
      database
        .selectFrom("bookingComponentAttempts")
        .select("id")
        .where("tripId", "=", command.tripId)
        .execute(),
      database
        .selectFrom("outboxEvents")
        .select("id")
        .where("aggregateId", "=", command.tripId)
        .where("eventType", "=", "booking.transaction.requested")
        .execute(),
    ]);
    result = {
      review,
      authorizations: authorizations.length,
      transactions: transactions.length,
      attempts: attempts.length,
      outbox: outbox.length,
    };
  } else {
    // This fixture-only reader replays seeded synthetic readiness. It is never installed in the app.
    const prerequisites: TrustedBookingPrerequisiteReader = {
      read: async (input) => {
        const saved = await database
          .selectFrom("bookingRevalidations")
          .select("terms")
          .where("tripId", "=", input.tripId)
          .where("ownerUserId", "=", input.ownerUserId)
          .where("status", "=", "completed")
          .orderBy("createdAt", "desc")
          .limit(1)
          .executeTakeFirstOrThrow();
        const evidence = bookingTermsV2Schema
          .parse(saved.terms)
          .components.find((entry) => entry.componentId === input.componentId)?.evidence;
        return {
          travellers: evidence?.travellerReadiness ?? null,
          payment: evidence?.paymentReadiness ?? null,
        };
      },
    };
    if (command.action === "authorize")
      result = await authorizeBooking(
        database,
        command.ownerUserId,
        command.tripId,
        command.request,
        new Date(),
        prerequisites,
      );
    else if (command.action === "start")
      result = projectPublicBookingTransaction(
        await startBooking(database, command.ownerUserId, command.tripId, command.request, {
          prerequisites,
        }),
        new Set(),
      );
    else if (command.action === "review-remainder") {
      const accepted = await startBookingRevalidation(
        database,
        command.ownerUserId,
        command.tripId,
        command.request,
      );
      const saved = await database
        .selectFrom("bookingRevalidations")
        .select("terms")
        .where("tripId", "=", command.tripId)
        .where("ownerUserId", "=", command.ownerUserId)
        .where("status", "=", "completed")
        .orderBy("createdAt", "desc")
        .executeTakeFirstOrThrow();
      const original = bookingTermsV2Schema.parse(saved.terms);
      const providers = new TransactionProviderRegistry();
      for (const provider of ["duffel", "nuitee", "viator"] as const)
        providers.register({
          provider,
          capabilities: {
            book: true,
            status: false,
            cancel: false,
            reschedule: false,
            idempotency: false,
            revalidation: "read_only_final_terms",
          },
          execute: async () => {
            throw new Error("The browser review fixture cannot dispatch");
          },
          revalidate: async ({ componentId }) => {
            const source = original.components.find(
              (component) => component.componentId === componentId,
            );
            if (!source) throw new Error("Synthetic review source is missing");
            const terms = structuredClone(source);
            terms.expiresAt = new Date(Date.now() + 300_000).toISOString();
            terms.evidence.checkedAt = new Date().toISOString();
            terms.evidence.expiresAt = terms.expiresAt;
            return { outcome: "unchanged", terms };
          },
        });
      const current = await readBookingReview(database, command.ownerUserId, command.tripId);
      const reviewed = await createRevalidationActivities(database, providers, {
        prerequisites,
      }).revalidateBooking({
        workflowId: accepted.workflowId,
        tripId: command.tripId,
        ownerUserId: command.ownerUserId,
        tripVersion: current.tripVersion,
      });
      if (reviewed.status !== "completed")
        throw new Error("Synthetic remaining review was blocked");
      result = { workflowId: accepted.workflowId, status: reviewed.status };
    } else if (command.action === "prepare-recovery") {
      const current = await readBookingReview(database, command.ownerUserId, command.tripId);
      if (!current.review?.termsHash)
        throw new Error("Synthetic recovery requires a complete review");
      const authorization = await authorizeBooking(
        database,
        command.ownerUserId,
        command.tripId,
        {
          requestId: randomUUID(),
          tripVersion: current.tripVersion,
          termsHash: current.review.termsHash,
          operation: "book_trip",
          componentId: null,
          acknowledgedNonReversibleActions: [],
        },
        new Date(),
        prerequisites,
      );
      const parent = await startBooking(
        database,
        command.ownerUserId,
        command.tripId,
        {
          requestId: randomUUID(),
          authorizationId: authorization.id,
        },
        { prerequisites },
      );
      const terms = bookingTermsV2Schema.parse(parent.executionBasis.terms);
      for (const [index, status] of ["confirmed", command.outcome].entries()) {
        const component = terms.components[index];
        const key = `${parent.id}:${component.componentId}:book_trip:${parent.executionBasis.termsHash}`;
        await inTransaction(database, async (transaction) => {
          await lockBookingEvidenceTrip(transaction, command.tripId);
          const locked = await transaction
            .selectFrom("bookingTransactions")
            .select("lastObservedTripVersion")
            .where("id", "=", parent.id)
            .forUpdate()
            .executeTakeFirstOrThrow();
          await transaction
            .updateTable("bookingTransactions")
            .set({ executionStatus: "active" })
            .where("id", "=", parent.id)
            .execute();
          const repository = new BookingRepository(transaction);
          const claimed = await repository.claimComponentWrite({
            tripId: command.tripId,
            componentId: component.componentId,
            transactionId: parent.id,
            attemptId: randomUUID(),
            expectedVersion: locked.lastObservedTripVersion,
            expiresAt: new Date(parent.executionBasis.expiresAt),
            now: new Date(),
            operation: "book_trip",
            idempotencyKey: key,
            requestFingerprint: createHash("sha256")
              .update(canonicalBookingJson({ operation: "book_trip", terms: component }))
              .digest("hex"),
            requirementIds: component.evidence.requirementIds,
          });
          if (!claimed) throw new Error("Synthetic recovery could not claim its injected outcome");
          await transaction
            .updateTable("bookingComponentAttempts")
            .set({ status: "dispatched" })
            .where("transactionId", "=", parent.id)
            .where("componentId", "=", component.componentId)
            .execute();
          await repository.recordProviderEvidence({
            transactionId: parent.id,
            componentId: component.componentId,
            idempotencyKey: key,
            reconciled: false,
            now: new Date(),
            result:
              status === "confirmed"
                ? {
                    status: "confirmed",
                    providerReference: "recorded-recovery-confirmation",
                    evidenceId: `recorded-recovery-${parent.id}`,
                    confirmedTerms: component,
                  }
                : status === "failed"
                  ? { status: "failed", safeReason: "Recorded definitive rejection." }
                  : { status: "unknown", safeReason: "Recorded possible commit; do not repeat." },
          });
        });
      }
      await database
        .updateTable("bookingTransactions")
        .set({ executionStatus: "invalidated" })
        .where("id", "=", parent.id)
        .execute();
      result = await readBookingReview(database, command.ownerUserId, command.tripId);
    }
  }
  console.log(JSON.stringify(result));
} finally {
  await database.destroy();
}
