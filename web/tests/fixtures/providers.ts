export type OfferStatus = "available" | "changed" | "unavailable";
export type CommitStatus = "confirmed" | "rejected";
export type ProviderScenario =
  | "success"
  | "timeout_after_commit"
  | "duplicate"
  | "contradictory";

export interface SyntheticOffer {
  readonly id: string;
  readonly provider: "synthetic-provider-v1";
  readonly status: OfferStatus;
  readonly amountMinor: number;
  readonly currency: "GBP";
  readonly replacesOfferId: string | null;
}

export interface CommitOutcome {
  readonly requestId: string;
  readonly offerId: string;
  readonly status: CommitStatus;
  readonly confirmationId: string | null;
  readonly duplicate: boolean;
  readonly sequence: number;
}

const offers = [
  {
    id: "offer-available-001",
    provider: "synthetic-provider-v1",
    status: "available",
    amountMinor: 42_000,
    currency: "GBP",
    replacesOfferId: null,
  },
  {
    id: "offer-changed-001",
    provider: "synthetic-provider-v1",
    status: "changed",
    amountMinor: 44_500,
    currency: "GBP",
    replacesOfferId: "offer-available-001",
  },
  {
    id: "offer-unavailable-001",
    provider: "synthetic-provider-v1",
    status: "unavailable",
    amountMinor: 42_000,
    currency: "GBP",
    replacesOfferId: null,
  },
] as const satisfies readonly SyntheticOffer[];

export const syntheticOffers = Object.freeze(offers);

export type ReadScenario = "success" | "no_matches" | "unsupported" | "rate_limited" | "deadline" | "error";
export interface ReadEvidence {
  status: OfferStatus | Exclude<ReadScenario, "success">;
  offers: readonly SyntheticOffer[];
  checkedAt: string;
  expiresAt: string | null;
  evidenceId: string;
}
export interface ProviderFixtureState {
  sequence: number;
  committed: CommitOutcome[];
  writes: number;
}

export class DeterministicClock {
  private instant: number;

  constructor(timestamp = "2030-01-01T00:00:00Z") {
    this.instant = Date.parse(timestamp);
    if (!Number.isFinite(this.instant)) throw new Error("Invalid synthetic clock");
  }

  now = (): Date => new Date(this.instant);

  advance(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error("Invalid clock advance");
    this.instant += milliseconds;
  }
}

export class TimeoutAfterCommitError extends Error {
  constructor(readonly outcome: CommitOutcome) {
    super(`Synthetic provider timed out after committing ${outcome.requestId}`);
    this.name = "TimeoutAfterCommitError";
  }
}

export class DeterministicProviderDouble {
  readonly committed = new Map<string, CommitOutcome>();
  readonly counters = { search: 0, detail: 0, revalidation: 0, writeAttempts: 0, writes: 0 };
  private sequence = 0;

  constructor(private readonly now: () => Date = new DeterministicClock().now, state?: ProviderFixtureState) {
    if (state) {
      this.sequence = state.sequence;
      this.counters.writes = state.writes;
      for (const outcome of state.committed) this.committed.set(outcome.requestId, structuredClone(outcome));
    }
  }

  snapshot(): ProviderFixtureState {
    return structuredClone({ sequence: this.sequence, committed: [...this.committed.values()], writes: this.counters.writes });
  }

  search(scenario: ReadScenario = "success"): ReadEvidence {
    return this.read("search", undefined, scenario);
  }

  detail(offerId: string, scenario: ReadScenario = "success"): ReadEvidence {
    return this.read("detail", offerId, scenario);
  }

  revalidate(offerId: string, scenario: ReadScenario = "success"): ReadEvidence {
    return this.read("revalidation", offerId, scenario);
  }

  private read(operation: "search" | "detail" | "revalidation", offerId: string | undefined, scenario: ReadScenario): ReadEvidence {
    const count = ++this.counters[operation];
    const checkedAt = this.now().toISOString();
    const selected = scenario !== "success" ? [] : offerId ? [this.quote(offerId)] : structuredClone(syntheticOffers);
    return { status: scenario === "success" ? selected[0]?.status ?? "no_matches" : scenario,
      offers: selected, checkedAt, expiresAt: selected.length ? new Date(Date.parse(checkedAt) + 300_000).toISOString() : null,
      evidenceId: `synthetic-${operation}-${count}` };
  }

  quote(offerId: string): SyntheticOffer {
    const offer = syntheticOffers.find(({ id }) => id === offerId);
    if (!offer) {
      throw new Error(`Unknown synthetic offer: ${offerId}`);
    }
    return structuredClone(offer);
  }

  commit(
    requestId: string,
    offerId: string,
    scenario: ProviderScenario = "success",
  ): readonly CommitOutcome[] {
    this.counters.writeAttempts += 1;
    const existing = this.committed.get(requestId);
    if (existing) {
      return [{ ...existing, duplicate: true }];
    }

    const offer = this.quote(offerId);
    const confirmed = this.record({
      requestId,
      offerId,
      status: offer.status === "unavailable" ? "rejected" : "confirmed",
      confirmationId:
        offer.status === "unavailable" ? null : `synthetic-confirmation-${requestId}`,
      duplicate: false,
    });

    if (scenario === "timeout_after_commit") {
      throw new TimeoutAfterCommitError(confirmed);
    }
    if (scenario === "contradictory") {
      return [
        confirmed,
        {
          ...confirmed,
          status: confirmed.status === "confirmed" ? "rejected" : "confirmed",
          confirmationId: null,
          sequence: ++this.sequence,
        },
      ];
    }
    if (scenario === "duplicate") {
      return [confirmed, { ...confirmed, duplicate: true }];
    }
    return [confirmed];
  }

  private record(
    outcome: Omit<CommitOutcome, "sequence">,
  ): CommitOutcome {
    const recorded = { ...outcome, sequence: ++this.sequence };
    this.counters.writes += 1;
    this.committed.set(recorded.requestId, recorded);
    return recorded;
  }
}