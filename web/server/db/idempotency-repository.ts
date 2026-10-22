import { ProblemError } from "@/server/errors";

import type { Transaction } from "kysely";
import type { Database } from "@/server/db/database";

export interface ClaimIdempotencyInput {
  scope: string;
  key: string;
  requestFingerprint: string;
  expiresAt: Date;
}

export type IdempotencyClaim =
  { kind: "claimed" } | { kind: "replay"; result: Record<string, unknown> };

export interface IdempotencyRepositoryPort {
  claim(input: ClaimIdempotencyInput): Promise<IdempotencyClaim>;
  complete(
    scope: string,
    key: string,
    requestFingerprint: string,
    result: Record<string, unknown>,
  ): Promise<void>;
}

export class IdempotencyFingerprintConflictError extends ProblemError {
  constructor() {
    super({
      title: "Idempotency key conflict",
      status: 409,
      code: "idempotency_fingerprint_conflict",
      detail: "The idempotency key was already used for a different request.",
    });
    this.name = "IdempotencyFingerprintConflictError";
  }
}

export class IdempotencyRequestInProgressError extends ProblemError {
  constructor(state: "in_progress" | "unknown") {
    super({
      title: state === "unknown" ? "Request outcome is unknown" : "Request is already in progress",
      status: 409,
      code: state === "unknown" ? "idempotency_outcome_unknown" : "idempotency_in_progress",
      detail:
        state === "unknown"
          ? "Check the existing operation status before retrying."
          : "Retry after the original request finishes.",
    });
    this.name = "IdempotencyRequestInProgressError";
  }
}

export class IdempotencyRepository implements IdempotencyRepositoryPort {
  constructor(private readonly transaction: Transaction<Database>) {}

  async claim(input: ClaimIdempotencyInput): Promise<IdempotencyClaim> {
    const inserted = await this.transaction
      .insertInto("idempotencyRecords")
      .values({
        scope: input.scope,
        idempotencyKey: input.key,
        requestFingerprint: input.requestFingerprint,
        state: "in_progress",
        resultReference: null,
        expiresAt: input.expiresAt,
      })
      .onConflict((conflict) => conflict.columns(["scope", "idempotencyKey"]).doNothing())
      .returning(["scope"])
      .executeTakeFirst();

    if (inserted) {
      return { kind: "claimed" };
    }

    const existing = await this.transaction
      .selectFrom("idempotencyRecords")
      .select(["requestFingerprint", "state", "resultReference"])
      .where("scope", "=", input.scope)
      .where("idempotencyKey", "=", input.key)
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (existing.requestFingerprint !== input.requestFingerprint) {
      throw new IdempotencyFingerprintConflictError();
    }
    if (existing.state === "completed") {
      if (existing.resultReference === null) {
        throw new IdempotencyRequestInProgressError("unknown");
      }
      return { kind: "replay", result: existing.resultReference };
    }
    throw new IdempotencyRequestInProgressError(existing.state);
  }

  async complete(
    scope: string,
    key: string,
    requestFingerprint: string,
    result: Record<string, unknown>,
  ): Promise<void> {
    const updated = await this.transaction
      .updateTable("idempotencyRecords")
      .set({ state: "completed", resultReference: result, updatedAt: new Date() })
      .where("scope", "=", scope)
      .where("idempotencyKey", "=", key)
      .where("requestFingerprint", "=", requestFingerprint)
      .where("state", "=", "in_progress")
      .returning(["scope"])
      .executeTakeFirst();

    if (!updated) {
      throw new IdempotencyFingerprintConflictError();
    }
  }
}
