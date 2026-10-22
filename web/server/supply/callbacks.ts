import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { z } from "zod";

import { bookingTermsSchema, canonicalBookingJson } from "@/domain/booking/authorization";
import { projectBookingTransactionRow } from "@/domain/booking/schema";
import { applyBookingOutcome } from "@/domain/booking/apply-outcomes";
import { providerForComponent } from "@/server/supply/transactions";
import { BookingRepository } from "@/server/db/booking-repository";
import { ProblemError } from "@/server/errors";

import type { Database } from "@/server/db/database";

const callbackStatuses = ["confirmed", "failed", "unknown", "action_required"] as const;
type CallbackStatus = (typeof callbackStatuses)[number];
const callbackSchema = z
  .object({
    providerEventId: z.string().min(1).max(256),
    transactionId: z.uuid(),
    componentId: z.uuid(),
    outcome: z.enum(callbackStatuses),
    providerReference: z.string().min(1).max(512).nullable(),
    confirmedTerms: z.unknown().nullable(),
    safeReason: z.string().max(500).nullable(),
  })
  .strict();
type CallbackProvider = "duffel" | "booking" | "getyourguide" | "trainline";

function secretFor(provider: CallbackProvider): string | undefined {
  const key = {
    duffel: "DUFFEL_CALLBACK_SECRET",
    booking: "BOOKING_CALLBACK_SECRET",
    getyourguide: "GETYOURGUIDE_CALLBACK_SECRET",
    trainline: "TRAINLINE_CALLBACK_SECRET",
  }[provider];
  return process.env[key];
}

export function verifyProviderCallback(
  provider: CallbackProvider,
  rawBody: string,
  signature: string | null,
): boolean {
  const secret = secretFor(provider);
  if (!secret || !signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const providedBytes = Buffer.from(signature),
    expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}

export async function processProviderCallback(
  database: Kysely<Database>,
  provider: CallbackProvider,
  rawBody: string,
  signature: string | null,
  now = new Date(),
) {
  if (!verifyProviderCallback(provider, rawBody, signature)) {
    throw new ProblemError({
      title: "Provider callback signature is invalid",
      status: 401,
      code: "invalid_provider_signature",
    });
  }
  const input = callbackSchema.parse(JSON.parse(rawBody));
  const fingerprint = createHash("sha256").update(canonicalBookingJson(input)).digest("hex");
  return database.transaction().execute(async (transaction) => {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${provider + ":" + input.providerEventId}, 0))`.execute(
      transaction,
    );
    const prior = await transaction
      .selectFrom("bookingProviderCallbacks")
      .selectAll()
      .where("provider", "=", provider)
      .where("providerEventId", "=", input.providerEventId)
      .forUpdate()
      .executeTakeFirst();
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new ProblemError({
          title: "Provider event conflicts with a prior callback",
          status: 409,
          code: "provider_callback_conflict",
        });
      return prior.result;
    }
    const row = await transaction
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", input.transactionId)
      .forUpdate()
      .executeTakeFirst();
    if (!row)
      throw new ProblemError({
        title: "Booking transaction not found",
        status: 404,
        code: "booking_not_found",
      });
    const booking = projectBookingTransactionRow(row);
    const authorizedTerms = booking.executionBasis.terms.components.find(
      (term) => term.componentId === input.componentId,
    );
    const version = await transaction
      .selectFrom("tripVersions")
      .select("snapshot")
      .where("tripId", "=", booking.tripId)
      .where("version", "=", booking.executionBasis.startingTripVersion)
      .executeTakeFirst();
    const component = (
      version?.snapshot as { components?: Array<{ id: string; type: string }> } | undefined
    )?.components?.find((entry) => entry.id === input.componentId);
    if (!authorizedTerms || !component || providerForComponent(component.type) !== provider) {
      throw new ProblemError({
        title: "Callback does not match the authorized provider operation",
        status: 409,
        code: "provider_callback_scope_mismatch",
      });
    }
    const existing = await transaction
      .selectFrom("bookingConfirmations")
      .select(["providerReference", "terms"])
      .where("transactionId", "=", booking.id)
      .where("componentId", "=", input.componentId)
      .executeTakeFirst();
    let outcome: {
      componentId: string;
      status: CallbackStatus;
      providerReference: string | null;
      safeReason: string | null;
    };
    if (
      existing &&
      (input.outcome !== "confirmed" ||
        existing.providerReference !== input.providerReference ||
        canonicalBookingJson(existing.terms) !== canonicalBookingJson(authorizedTerms))
    ) {
      outcome = {
        componentId: input.componentId,
        status: "action_required",
        providerReference: existing.providerReference,
        safeReason:
          "A contradictory provider update was received. Existing confirmation evidence was preserved.",
      };
    } else if (input.outcome === "confirmed") {
      const confirmedTerms = bookingTermsSchema.shape.components.element.parse(
        input.confirmedTerms,
      );
      if (
        canonicalBookingJson(confirmedTerms) !== canonicalBookingJson(authorizedTerms) ||
        !input.providerReference
      ) {
        await transaction
          .updateTable("bookingTransactions")
          .set({ executionStatus: "invalidated", status: "action_required" })
          .where("id", "=", booking.id)
          .execute();
        outcome = {
          componentId: input.componentId,
          status: "action_required",
          providerReference: null,
          safeReason: "Provider confirmation did not match the authorized terms.",
        };
      } else {
        await transaction
          .insertInto("bookingConfirmations")
          .values({
            id: randomUUID(),
            transactionId: booking.id,
            tripId: booking.tripId,
            componentId: input.componentId,
            providerReference: input.providerReference,
            terms: authorizedTerms,
            confirmedAt: now,
          })
          .onConflict((conflict) => conflict.columns(["transactionId", "componentId"]).doNothing())
          .execute();
        await new BookingRepository(transaction).releaseResolvedClaim(
          booking.tripId,
          input.componentId,
          booking.id,
        );
        outcome = {
          componentId: input.componentId,
          status: "confirmed",
          providerReference: input.providerReference,
          safeReason: null,
        };
      }
    } else {
      const status = input.outcome;
      outcome = {
        componentId: input.componentId,
        status,
        providerReference: null,
        safeReason: input.safeReason ?? "Provider status requires review.",
      };
      if (status === "failed")
        await new BookingRepository(transaction).releaseResolvedClaim(
          booking.tripId,
          input.componentId,
          booking.id,
        );
      if (status === "unknown" || status === "action_required") {
        await new BookingRepository(transaction).retainUnknownClaim({
          tripId: booking.tripId,
          componentId: input.componentId,
          transactionId: booking.id,
          evidence: { providerEventId: input.providerEventId },
          now,
        });
      }
    }
    await transaction
      .insertInto("bookingProviderCallbacks")
      .values({
        provider,
        providerEventId: input.providerEventId,
        fingerprint,
        transactionId: booking.id,
        componentId: input.componentId,
        outcome: outcome.status,
        result: { accepted: true, outcome: outcome.status },
        receivedAt: now,
      })
      .execute();
    await transaction
      .insertInto("auditEvents")
      .values({
        id: randomUUID(),
        actorType: "service",
        actorId: `provider:${provider}`,
        action: "booking.provider_callback",
        targetType: "booking_transaction",
        targetId: booking.id,
        requestId: randomUUID(),
        traceId: null,
        outcome: outcome.status === "action_required" ? "failed" : "succeeded",
        metadata: {
          componentId: input.componentId,
          providerEventId: input.providerEventId,
          fingerprint,
          outcome: outcome.status,
        },
        occurredAt: now,
      })
      .execute();
    await applyBookingOutcome(transaction, booking.id, outcome, now);
    return { accepted: true, outcome: outcome.status };
  });
}
