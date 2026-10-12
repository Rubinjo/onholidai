from dataclasses import dataclass, replace
from typing import Literal

OfferStatus = Literal["available", "changed", "unavailable"]
CommitStatus = Literal["confirmed", "rejected"]
ProviderScenario = Literal[
    "success", "timeout_after_commit", "duplicate", "contradictory"
]


@dataclass(frozen=True, slots=True)
class SyntheticOffer:
    id: str
    status: OfferStatus
    amount_minor: int
    currency: Literal["GBP"] = "GBP"
    provider: Literal["synthetic-provider-v1"] = "synthetic-provider-v1"
    replaces_offer_id: str | None = None


@dataclass(frozen=True, slots=True)
class CommitOutcome:
    request_id: str
    offer_id: str
    status: CommitStatus
    confirmation_id: str | None
    duplicate: bool
    sequence: int


SYNTHETIC_OFFERS = (
    SyntheticOffer("offer-available-001", "available", 42_000),
    SyntheticOffer(
        "offer-changed-001",
        "changed",
        44_500,
        replaces_offer_id="offer-available-001",
    ),
    SyntheticOffer("offer-unavailable-001", "unavailable", 42_000),
)


class TimeoutAfterCommitError(RuntimeError):
    def __init__(self, outcome: CommitOutcome) -> None:
        self.outcome = outcome
        super().__init__(f"Synthetic provider timed out after committing {outcome.request_id}")


class DeterministicProviderDouble:
    def __init__(self) -> None:
        self.committed: dict[str, CommitOutcome] = {}
        self._sequence = 0

    def quote(self, offer_id: str) -> SyntheticOffer:
        try:
            return next(offer for offer in SYNTHETIC_OFFERS if offer.id == offer_id)
        except StopIteration as error:
            raise ValueError(f"Unknown synthetic offer: {offer_id}") from error

    def commit(
        self,
        request_id: str,
        offer_id: str,
        scenario: ProviderScenario = "success",
    ) -> tuple[CommitOutcome, ...]:
        existing = self.committed.get(request_id)
        if existing is not None:
            return (replace(existing, duplicate=True),)

        offer = self.quote(offer_id)
        status: CommitStatus = "rejected" if offer.status == "unavailable" else "confirmed"
        confirmed = self._record(
            request_id=request_id,
            offer_id=offer_id,
            status=status,
            confirmation_id=(
                None if status == "rejected" else f"synthetic-confirmation-{request_id}"
            ),
        )

        if scenario == "timeout_after_commit":
            raise TimeoutAfterCommitError(confirmed)
        if scenario == "duplicate":
            return confirmed, replace(confirmed, duplicate=True)
        if scenario == "contradictory":
            self._sequence += 1
            contradictory = replace(
                confirmed,
                status="rejected" if confirmed.status == "confirmed" else "confirmed",
                confirmation_id=None,
                sequence=self._sequence,
            )
            return confirmed, contradictory
        return (confirmed,)

    def _record(
        self,
        *,
        request_id: str,
        offer_id: str,
        status: CommitStatus,
        confirmation_id: str | None,
    ) -> CommitOutcome:
        self._sequence += 1
        outcome = CommitOutcome(
            request_id=request_id,
            offer_id=offer_id,
            status=status,
            confirmation_id=confirmation_id,
            duplicate=False,
            sequence=self._sequence,
        )
        self.committed[request_id] = outcome
        return outcome