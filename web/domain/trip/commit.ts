import { createHash } from "node:crypto";

import type { Kysely, Transaction } from "kysely";
import { z } from "zod";

import { draftOperationSchema, tripSnapshotSchema, tripVersionSchema } from "@/domain/trip/schema";
import { ProblemError } from "@/server/errors";
import type { Database } from "@/server/db/database";
import {
  IdempotencyRepository,
  type IdempotencyRepositoryPort,
} from "@/server/db/idempotency-repository";
import { TripRepository, type TripRepositoryPort } from "@/server/db/trip-repository";

const commitInputSchema = z
  .object({
    tripId: z.uuid(),
    ownerUserId: z.string().trim().min(1),
    expectedVersion: z.number().int().positive(),
    requestId: z.uuid(),
    idempotencyKey: z.string().trim().min(1).max(256),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    snapshot: tripSnapshotSchema,
    initiatingActor: z.enum(["user", "agent_proposal", "system_revalidation", "booking_workflow"]),
    proposalId: z.uuid().nullable(),
    changeSummary: z.array(z.string().trim().min(1).max(256)).min(1).max(64),
    inverseOperation: draftOperationSchema.nullable(),
    nonReversibleReason: z.string().trim().min(1).max(1000).nullable(),
    outboxEventId: z.uuid(),
    auditEventId: z.uuid(),
    traceId: z.string().trim().min(1).max(128).nullable().default(null),
  })
  .strict();

const commitResultSchema = z
  .object({
    tripId: z.uuid(),
    previousVersion: z.number().int().positive(),
    version: z.number().int().positive(),
    outboxEventId: z.uuid(),
    replayed: z.boolean(),
  })
  .strict();

export type CommitTripMutationInput = z.input<typeof commitInputSchema>;
export type CommitTripMutationResult = z.infer<typeof commitResultSchema>;

interface CommitRepositories {
  idempotency: IdempotencyRepositoryPort;
  trips: TripRepositoryPort;
}

export interface CommitTripMutationOptions {
  now?: () => Date;
  repositoryFactory?: (transaction: Transaction<Database>) => CommitRepositories;
}

class TripNotFoundError extends ProblemError {
  constructor() {
    super({ title: "Trip not found", status: 404, code: "trip_not_found" });
  }
}

class TripOwnershipError extends ProblemError {
  constructor() {
    super({ title: "Trip access denied", status: 403, code: "trip_access_denied" });
  }
}

export class TripVersionConflictError extends ProblemError {
  constructor(expectedVersion: number, currentVersion: number) {
    super({
      title: "Trip version conflict",
      status: 409,
      code: "trip_version_conflict",
      detail: `Expected version ${expectedVersion}; current version is ${currentVersion}.`,
    });
    this.name = "TripVersionConflictError";
  }
}

function defaultRepositoryFactory(transaction: Transaction<Database>): CommitRepositories {
  return {
    idempotency: new IdempotencyRepository(transaction),
    trips: new TripRepository(transaction),
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Mutation values must be JSON serializable");
  return encoded;
}

export async function commitTripMutation(
  database: Kysely<Database>,
  rawInput: CommitTripMutationInput,
  options: CommitTripMutationOptions = {},
): Promise<CommitTripMutationResult> {
  const input = commitInputSchema.parse(rawInput);
  const now = (options.now ?? (() => new Date()))();
  const repositoryFactory = options.repositoryFactory ?? defaultRepositoryFactory;
  const scope = `trip:${input.tripId}:mutation`;
  // Bind the receipt to validated domain facts and the authenticated actor.
  // Server-generated delivery/audit/trace IDs may differ on an exact retry.
  const requestFingerprint = createHash("sha256").update(canonicalJson({
    tripId: input.tripId, ownerUserId: input.ownerUserId, expectedVersion: input.expectedVersion,
    requestId: input.requestId, requestFingerprint: input.requestFingerprint,
    snapshot: input.snapshot, initiatingActor: input.initiatingActor, proposalId: input.proposalId,
    changeSummary: input.changeSummary, inverseOperation: input.inverseOperation,
    nonReversibleReason: input.nonReversibleReason,
  })).digest("hex");

  const nextVersion = input.expectedVersion + 1;
  const version = tripVersionSchema.parse({
    tripId: input.tripId, version: nextVersion, previousVersion: input.expectedVersion,
    schemaVersion: 1, snapshot: input.snapshot, initiatingActor: input.initiatingActor,
    initiatingRequestId: input.requestId, proposalId: input.proposalId,
    changeSummary: input.changeSummary, inverseOperation: input.inverseOperation,
    nonReversibleReason: input.nonReversibleReason, createdAt: now.toISOString(),
  });

  return database.transaction().execute(async (transaction) => {
    const repositories = repositoryFactory(transaction);
    const trip = await repositories.trips.lockTrip(input.tripId);
    if (!trip) throw new TripNotFoundError();
    if (trip.ownerUserId !== input.ownerUserId) throw new TripOwnershipError();

    const claim = await repositories.idempotency.claim({
      scope,
      key: input.idempotencyKey,
      requestFingerprint,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    if (claim.kind === "replay") {
      return { ...commitResultSchema.parse(claim.result), replayed: true };
    }

    if (trip.currentVersion !== input.expectedVersion) {
      throw new TripVersionConflictError(input.expectedVersion, trip.currentVersion);
    }

    await repositories.trips.insertVersion(version);
    const advanced = await repositories.trips.advanceCurrentVersion(
      input.tripId,
      input.expectedVersion,
      nextVersion,
      input.snapshot.price.currency,
      now,
    );
    if (!advanced) {
      throw new TripVersionConflictError(input.expectedVersion, trip.currentVersion);
    }

    await repositories.trips.appendOutbox({
      id: input.outboxEventId,
      eventType: "trip.version.committed",
      eventVersion: 1,
      aggregateType: "trip",
      aggregateId: input.tripId,
      aggregateVersion: nextVersion,
      payload: {
        tripId: input.tripId,
        version: nextVersion,
        previousVersion: input.expectedVersion,
        initiatingActor: input.initiatingActor,
        requestId: input.requestId,
        reloadRequired: true,
      },
      leaseExpiresAt: null,
      deliveredAt: null,
      lastErrorCategory: null,
    });
    await repositories.trips.appendAudit({
      id: input.auditEventId,
      actorType: input.initiatingActor === "user" ? "user" : "service",
      actorId: input.ownerUserId,
      action: "trip.version.commit",
      targetType: "trip",
      targetId: input.tripId,
      requestId: input.requestId,
      traceId: input.traceId,
      outcome: "succeeded",
      metadata: { version: nextVersion, changedFieldCount: input.changeSummary.length },
    });

    const result = commitResultSchema.parse({
      tripId: input.tripId,
      previousVersion: input.expectedVersion,
      version: nextVersion,
      outboxEventId: input.outboxEventId,
      replayed: false,
    });
    await repositories.idempotency.complete(
      scope,
      input.idempotencyKey,
      requestFingerprint,
      result,
    );
    return result;
  });
}
