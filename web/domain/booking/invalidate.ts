import { ProblemError } from "@/server/errors";

import { canonicalBookingJson } from "./authorization";
import { tripSnapshotSchema, type TripSnapshot } from "../trip/schema";
import { bookingComponentStateSchema } from "./schema";

import type { Transaction } from "kysely";
import type { Database } from "@/server/db/database";

export async function invalidateChangedWholeTripReview(
  transaction: Transaction<Database>,
  tripId: string,
  termsHash: string | null,
): Promise<void> {
  let update = transaction
    .updateTable("bookingAuthorizations")
    .set({
      status: "invalidated",
      reason: termsHash ? "booking_terms_changed" : "booking_review_failed",
    })
    .where("tripId", "=", tripId)
    .where("operation", "=", "book_trip")
    .where("status", "=", "authorized");
  if (termsHash) update = update.where("termsHash", "!=", termsHash);
  await update.execute();
}

export async function assertBookingCommitmentsPreserved(
  transaction: Transaction<Database>,
  tripId: string,
  currentVersion: number,
  snapshot: TripSnapshot,
  bookingTransactionId: string | null,
): Promise<void> {
  const current = await transaction
    .selectFrom("tripVersions")
    .select("snapshot")
    .where("tripId", "=", tripId)
    .where("version", "=", currentVersion)
    .executeTakeFirstOrThrow();
  const previous = tripSnapshotSchema.parse(current.snapshot);
  const ownAttempt = bookingTransactionId
    ? await transaction
        .selectFrom("bookingTransactions")
        .select("components")
        .where("id", "=", bookingTransactionId)
        .where("tripId", "=", tripId)
        .executeTakeFirstOrThrow()
    : null;
  const ownIds = new Set(
    ownAttempt
      ? bookingComponentStateSchema
          .array()
          .parse(ownAttempt.components)
          .map((entry) => entry.componentId)
      : [],
  );
  for (const component of previous.components.filter(
    (entry) =>
      entry.bookingStatus !== "unbooked" &&
      entry.bookingStatus !== "cancelled" &&
      !ownIds.has(entry.id),
  )) {
    const replacement = snapshot.components.find((entry) => entry.id === component.id);
    if (!replacement || canonicalBookingJson(component) !== canonicalBookingJson(replacement))
      throw new ProblemError({
        title: "A provider commitment cannot be changed as a planning edit",
        status: 409,
        code: "booking_commitment_immutable",
        detail:
          "Keep existing commitments and use their separately authorized change or cancellation flow.",
      });
  }
}

export async function assertBookingWritesEditable(
  transaction: Transaction<Database>,
  tripId: string,
  actor: string,
  bookingTransactionId: string | null,
): Promise<void> {
  const claims = await transaction
    .selectFrom("bookingWriteClaims")
    .select(["transactionId", "state"])
    .where("tripId", "=", tripId)
    .forUpdate()
    .execute();
  const unrelated = claims.filter(
    (claim) => actor !== "booking_workflow" || claim.transactionId !== bookingTransactionId,
  );
  if (unrelated.length > 0) {
    throw new ProblemError({
      title: "A provider action is still in progress",
      status: 409,
      code: "booking_write_in_progress",
      detail: "Reconcile the affected provider action before changing these trip terms.",
    });
  }
}

export async function invalidateBookingStateForTripVersion(
  transaction: Transaction<Database>,
  tripId: string,
  bookingTransactionId: string | null,
): Promise<void> {
  await transaction
    .updateTable("bookingAuthorizations")
    .set({ status: "invalidated", reason: "trip_version_changed" })
    .where("tripId", "=", tripId)
    .where("status", "=", "authorized")
    .execute();
  if (bookingTransactionId) return;
  await transaction
    .updateTable("bookingTransactions")
    .set({ executionStatus: "invalidated", status: "action_required" })
    .where("tripId", "=", tripId)
    .where("executionStatus", "=", "active")
    .execute();
}
