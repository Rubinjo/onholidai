import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import { commitTripMutation } from "./commit";
import { readTrip } from "./read";
import {
  currencySchema,
  publicTripPriceSchema,
  tripSnapshotSchema,
  type TripSnapshot,
} from "./schema";

import type { Database } from "@/server/db/database";
import type { Kysely } from "kysely";

export const createTripRequestSchema = z
  .object({
    requestId: z.uuid(),
    title: z.string().trim().min(1).max(120),
    currency: currencySchema,
    snapshot: z
      .object({
        ...tripSnapshotSchema.shape,
        itineraryDays: z.array(z.never()).max(0),
        components: z.array(z.never()).max(0),
        price: publicTripPriceSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.snapshot.price.currency !== input.currency ||
      input.snapshot.price.finalCustomerMinor !== 0 ||
      (input.snapshot.price.taxesMinor ?? 0) !== 0 ||
      (input.snapshot.price.feesMinor ?? 0) !== 0 ||
      input.snapshot.price.status !== "estimated"
    ) {
      context.addIssue({
        code: "custom",
        path: ["snapshot", "price"],
        message: "New drafts require an empty estimate in the trip currency",
      });
    }
  });

export function initialTripSnapshot(rawRequest: unknown, now: Date): TripSnapshot {
  const input = createTripRequestSchema.parse(rawRequest);
  const zero = { currency: input.currency, minorUnits: 0 };
  return tripSnapshotSchema.parse({
    ...input.snapshot,
    price: {
      currency: input.currency,
      supplierTotal: zero,
      platformMarginTotal: zero,
      customerPayableTaxesTotal: zero,
      customerPayableFeesTotal: zero,
      finalCustomerTotal: zero,
      status: "estimated",
      checkedAt: now.toISOString(),
      conversionDisclosures: [],
    },
    warnings: [
      ...input.snapshot.warnings,
      {
        code: "estimate_pending",
        message:
          "No estimate has been accepted. Research and explicit proposal acceptance are required.",
        severity: "info",
        relatedIds: [],
      },
      ...input.snapshot.constraints
        .filter((constraint) => ["conflicting", "unverified"].includes(constraint.status))
        .map((constraint) => ({
          code: `constraint_${constraint.status}`,
          message: constraint.statement,
          severity:
            constraint.status === "conflicting" && constraint.priority === "required"
              ? "blocking"
              : "warning",
          relatedIds: [constraint.id],
        })),
    ],
  });
}

export async function createTrip(
  database: Kysely<Database>,
  ownerUserId: string,
  rawRequest: unknown,
) {
  const input = createTripRequestSchema.parse(rawRequest);
  const now = new Date();
  const snapshot = initialTripSnapshot(input, now);
  const result = await commitTripMutation(
    database,
    {
      tripId: randomUUID(),
      ownerUserId,
      creation: { title: input.title },
      expectedVersion: 0,
      requestId: input.requestId,
      idempotencyKey: input.requestId,
      requestFingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      snapshot,
      initiatingActor: "user",
      proposalId: null,
      changeSummary: ["Trip created"],
      inverseOperation: null,
      nonReversibleReason: "Initial trip creation has no prior version to restore.",
      outboxEventId: randomUUID(),
      auditEventId: randomUUID(),
    },
    { now: () => now },
  );
  const original = await readTrip(database, ownerUserId, result.tripId, { version: 1 });
  return { ...original, lifecycleState: "draft" as const };
}
