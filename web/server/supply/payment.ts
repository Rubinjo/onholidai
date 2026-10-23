import "server-only";

import { canonicalBookingJson, type BookingTermsV2 } from "@/domain/booking/authorization";
import {
  opaqueReadinessSchema,
  verifiedBookingDispositionSchema,
} from "@/domain/trip/booking-coverage";
import { ProblemError } from "@/server/errors";

import type { z } from "zod";

type Readiness = z.infer<typeof opaqueReadinessSchema>;
export interface TrustedBookingPrerequisiteReader {
  read(input: {
    ownerUserId: string;
    tripId: string;
    tripVersion: number;
    componentId: string;
    provider: string;
    inventoryId: string;
    travellerIds: readonly string[];
    signal?: AbortSignal;
  }): Promise<{ travellers: Readiness | null; payment: Readiness | null }>;
  readDispositions?(input: {
    ownerUserId: string;
    tripId: string;
    tripVersion: number;
    signal: AbortSignal;
  }): Promise<z.infer<typeof verifiedBookingDispositionSchema>[]>;
}

async function boundedTrustedRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const unavailable = () =>
    new ProblemError({
      title: "Trusted booking evidence is unavailable",
      status: 409,
      code: "booking_prerequisites_unavailable",
      detail: "Refresh the review when the approved booking sources can verify the current facts.",
    });
  if (signal.aborted) throw unavailable();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(unavailable());
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } catch {
    throw unavailable();
  } finally {
    if (abort) signal.removeEventListener("abort", abort);
  }
}
export async function readTrustedBookingPrerequisites(
  reader: TrustedBookingPrerequisiteReader,
  input: Omit<Parameters<TrustedBookingPrerequisiteReader["read"]>[0], "signal">,
  signal = AbortSignal.timeout(8_000),
) {
  const value = await boundedTrustedRead(() => reader.read({ ...input, signal }), signal);
  return {
    travellers: opaqueReadinessSchema.nullable().parse(value.travellers),
    payment: opaqueReadinessSchema.nullable().parse(value.payment),
  };
}
export async function readTrustedBookingDispositions(
  reader: TrustedBookingPrerequisiteReader | undefined,
  input: { ownerUserId: string; tripId: string; tripVersion: number },
  signal = AbortSignal.timeout(8_000),
) {
  if (!reader?.readDispositions) return [];
  const read = reader.readDispositions.bind(reader);
  return verifiedBookingDispositionSchema
    .array()
    .max(768)
    .parse(await boundedTrustedRead(() => read({ ...input, signal }), signal));
}

export async function assertTrustedBookingPrerequisites(
  reader: TrustedBookingPrerequisiteReader | undefined,
  ownerUserId: string,
  tripId: string,
  terms: BookingTermsV2,
): Promise<void> {
  if (!reader)
    throw new ProblemError({
      title: "Trusted booking prerequisites are unavailable",
      status: 409,
      code: "booking_prerequisites_missing",
      detail: "An approved traveller and payment source must be ready before booking.",
    });
  const signal = AbortSignal.timeout(8_000);
  const dispositions = await readTrustedBookingDispositions(
    reader,
    { ownerUserId, tripId, tripVersion: terms.tripVersion },
    signal,
  );
  if (canonicalBookingJson(dispositions) !== canonicalBookingJson(terms.dispositionEvidence))
    throw new ProblemError({
      title: "Trusted booking classification changed",
      status: 409,
      code: "booking_prerequisites_changed",
      detail: "Refresh the whole-trip review and its verified booking requirements.",
    });
  for (const component of terms.components.filter((entry) => entry.disposition === "to_book")) {
    const readiness = await readTrustedBookingPrerequisites(
      reader,
      {
        ownerUserId,
        tripId,
        tripVersion: terms.tripVersion,
        componentId: component.componentId,
        provider: component.provider,
        inventoryId: component.inventoryId,
        travellerIds: component.travellerIds,
      },
      signal,
    );
    const travellers = opaqueReadinessSchema.nullable().parse(readiness.travellers);
    const payment = opaqueReadinessSchema.nullable().parse(readiness.payment);
    if (
      !travellers ||
      !payment ||
      canonicalBookingJson(travellers) !==
        canonicalBookingJson(component.evidence.travellerReadiness) ||
      canonicalBookingJson(payment) !== canonicalBookingJson(component.evidence.paymentReadiness)
    )
      throw new ProblemError({
        title: "Trusted booking prerequisites changed",
        status: 409,
        code: "booking_prerequisites_changed",
        detail:
          "Refresh the complete review after the approved traveller and payment sources are ready.",
      });
  }
}

export async function withEphemeralPaymentToken<T>(
  token: Uint8Array,
  action: (token: Uint8Array) => Promise<T>,
): Promise<T> {
  try {
    if (token.byteLength < 16 || token.byteLength > 4096)
      throw new Error("Invalid ephemeral payment token");
    return await action(token);
  } finally {
    token.fill(0);
  }
}
