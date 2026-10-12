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

export class TimeoutAfterCommitError extends Error {
  constructor(readonly outcome: CommitOutcome) {
    super(`Synthetic provider timed out after committing ${outcome.requestId}`);
    this.name = "TimeoutAfterCommitError";
  }
}

export class DeterministicProviderDouble {
  readonly committed = new Map<string, CommitOutcome>();
  private sequence = 0;

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
    this.committed.set(recorded.requestId, recorded);
    return recorded;
  }
}