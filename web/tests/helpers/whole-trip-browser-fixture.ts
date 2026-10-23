import { z } from "zod";

import { createDatabase } from "../../server/db/database";
import { authorizeBooking } from "../../domain/booking/authorize";
import { startBooking } from "../../domain/booking/start";
import { readBookingReview } from "../../domain/booking/revalidate";
import { bookingTermsV2Schema } from "../../domain/booking/authorization";
import { projectPublicBookingTransaction } from "../../domain/booking/schema";
import { seedReviewedWholeTrip } from "./booking";

import type { TrustedBookingPrerequisiteReader } from "../../server/supply/payment";

const command = z
  .discriminatedUnion("action", [
    z
      .object({ action: z.literal("seed"), ownerUserId: z.string(), incomplete: z.boolean() })
      .strict(),
    z
      .object({
        action: z.enum(["authorize", "start"]),
        ownerUserId: z.string(),
        tripId: z.uuid(),
        request: z.unknown(),
      })
      .strict(),
    z.object({ action: z.literal("inspect"), ownerUserId: z.string(), tripId: z.uuid() }).strict(),
  ])
  .parse(JSON.parse(process.argv[2] ?? ""));
const connectionString = process.env.US3_REVIEW_FIXTURE_DATABASE_URL;
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
            snapshot.price.supplierTotal.minorUnits -= missing.price.supplierAmount.minorUnits;
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
          .where("tripVersion", "=", input.tripVersion)
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
    result =
      command.action === "authorize"
        ? await authorizeBooking(
            database,
            command.ownerUserId,
            command.tripId,
            command.request,
            new Date(),
            prerequisites,
          )
        : projectPublicBookingTransaction(
            await startBooking(database, command.ownerUserId, command.tripId, command.request, {
              prerequisites,
            }),
            new Set(),
          );
  }
  console.log(JSON.stringify(result));
} finally {
  await database.destroy();
}
