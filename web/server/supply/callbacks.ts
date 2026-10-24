import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { sql, type Kysely } from "kysely";
import { z } from "zod";

import { canonicalBookingJson } from "@/domain/booking/authorization";
import { projectBookingTransactionRow } from "@/domain/booking/schema";
import { tripSnapshotSchema } from "@/domain/trip/schema";
import { providerForComponent, type TransactionOutcome } from "@/server/supply/transactions";
import { BookingRepository } from "@/server/db/booking-repository";
import { ProblemError } from "@/server/errors";
import { lockBookingEvidenceTrip } from "@/server/auth/booking-access";

import type { Database } from "@/server/db/database";

const callbackSchema = z
  .object({
    providerEventId: z.string().min(1).max(256),
    transactionId: z.uuid(),
    componentId: z.uuid(),
    outcome: z.enum(["confirmed", "failed", "unknown", "action_required"]),
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
  if (!verifyProviderCallback(provider, rawBody, signature))
    throw new ProblemError({
      title: "Provider callback signature is invalid",
      status: 401,
      code: "invalid_provider_signature",
    });
  const input = callbackSchema.parse(JSON.parse(rawBody));
  if (input.outcome === "confirmed" && !input.providerReference)
    throw new ProblemError({
      title: "A confirmation reference is required",
      status: 400,
      code: "invalid_provider_confirmation",
    });
  const fingerprint = createHash("sha256").update(canonicalBookingJson(input)).digest("hex");
  const result = await database.transaction().execute(async (transaction) => {
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
    if (prior?.fingerprint === fingerprint) return { result: prior.result, conflict: false };
    if (
      prior &&
      (prior.transactionId !== input.transactionId || prior.componentId !== input.componentId)
    )
      throw new ProblemError({
        title: "Provider event conflicts with a prior callback",
        status: 409,
        code: "provider_callback_conflict",
      });
    const identity = await transaction
      .selectFrom("bookingTransactions")
      .select("tripId")
      .where("id", "=", input.transactionId)
      .executeTakeFirst();
    if (!identity)
      throw new ProblemError({
        title: "Booking transaction not found",
        status: 404,
        code: "booking_not_found",
      });
    await lockBookingEvidenceTrip(transaction, identity.tripId);
    const row = await transaction
      .selectFrom("bookingTransactions")
      .selectAll()
      .where("id", "=", input.transactionId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    const booking = projectBookingTransactionRow(row);
    const terms = booking.executionBasis.terms.components.find(
      (term) => term.componentId === input.componentId,
    );
    const version = await transaction
      .selectFrom("tripVersions")
      .select("snapshot")
      .where("tripId", "=", booking.tripId)
      .where("version", "=", booking.executionBasis.startingTripVersion)
      .executeTakeFirstOrThrow();
    const component = tripSnapshotSchema
      .parse(version.snapshot)
      .components.find((entry) => entry.id === input.componentId);
    if (
      !terms ||
      !component ||
      providerForComponent(component.type, component.provider) !== provider ||
      ("provider" in terms && terms.provider !== provider)
    )
      throw new ProblemError({
        title: "Callback does not match the authorized provider operation",
        status: 409,
        code: "provider_callback_scope_mismatch",
      });
    const providerResult: TransactionOutcome =
      input.outcome === "confirmed" && input.providerReference
        ? {
            status: "confirmed",
            providerReference: input.providerReference,
            confirmedTerms: input.confirmedTerms,
            evidenceId: input.providerEventId,
          }
        : {
            status: input.outcome === "confirmed" ? "unknown" : input.outcome,
            safeReason: "Authenticated provider status requires review.",
          };
    const outcome = await new BookingRepository(transaction).recordProviderEvidence({
      transactionId: booking.id,
      componentId: input.componentId,
      idempotencyKey: `${booking.id}:${input.componentId}:${booking.operation}:${booking.executionBasis.termsHash}`,
      result: providerResult,
      reconciled: true,
      now,
    });
    const receipt = { accepted: true, outcome: outcome.status };
    if (!prior)
      await transaction
        .insertInto("bookingProviderCallbacks")
        .values({
          provider,
          providerEventId: input.providerEventId,
          fingerprint,
          transactionId: booking.id,
          componentId: input.componentId,
          outcome: outcome.status,
          result: receipt,
          receivedAt: now,
        })
        .execute();
    await transaction
      .insertInto("auditEvents")
      .values({
        id: randomUUID(),
        actorType: "service",
        actorId: `provider:${provider}`,
        action: prior ? "booking.provider_callback_conflict" : "booking.provider_callback",
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
    return { result: receipt, conflict: Boolean(prior) };
  });
  if (result.conflict)
    throw new ProblemError({
      title: "Provider event conflicts with a prior callback",
      status: 409,
      code: "provider_callback_conflict",
    });
  return result.result;
}
