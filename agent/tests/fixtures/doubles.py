from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
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

type ReadScenario = Literal[
    "success", "no_matches", "unsupported", "rate_limited", "deadline", "error"
]
type ReadStatus = Literal[
    "available", "changed", "unavailable", "no_matches", "unsupported", "rate_limited",
    "deadline", "error"
]


@dataclass(frozen=True, slots=True)
class ReadEvidence:
    status: ReadStatus
    offers: tuple[SyntheticOffer, ...]
    checked_at: str
    expires_at: str | None
    evidence_id: str


@dataclass(frozen=True, slots=True)
class ProviderFixtureState:
    sequence: int
    committed: tuple[CommitOutcome, ...]
    writes: int


class DeterministicClock:
    def __init__(self, timestamp: str = "2030-01-01T00:00:00Z") -> None:
        self._instant = datetime.fromisoformat(timestamp)
        if self._instant.tzinfo is None:
            raise ValueError("Synthetic clock requires an offset")

    def now(self) -> datetime:
        return self._instant

    def advance(self, milliseconds: int) -> None:
        if isinstance(milliseconds, bool) or milliseconds < 0:
            raise ValueError("Invalid clock advance")
        self._instant += timedelta(milliseconds=milliseconds)


class TimeoutAfterCommitError(RuntimeError):
    def __init__(self, outcome: CommitOutcome) -> None:
        self.outcome = outcome
        super().__init__(f"Synthetic provider timed out after committing {outcome.request_id}")


class DeterministicProviderDouble:
    def __init__(
        self,
        now: Callable[[], datetime] | None = None,
        state: ProviderFixtureState | None = None,
    ) -> None:
        self._now = now or DeterministicClock().now
        self.committed: dict[str, CommitOutcome] = {
            outcome.request_id: outcome for outcome in state.committed
        } if state else {}
        self._sequence = state.sequence if state else 0
        self.counters = {
            "search": 0, "detail": 0, "revalidation": 0, "write_attempts": 0,
            "writes": state.writes if state else 0,
        }

    def snapshot(self) -> ProviderFixtureState:
        return ProviderFixtureState(
            self._sequence, tuple(self.committed.values()), self.counters["writes"]
        )

    def search(self, scenario: ReadScenario = "success") -> ReadEvidence:
        return self._read("search", None, scenario)

    def detail(self, offer_id: str, scenario: ReadScenario = "success") -> ReadEvidence:
        return self._read("detail", offer_id, scenario)

    def revalidate(self, offer_id: str, scenario: ReadScenario = "success") -> ReadEvidence:
        return self._read("revalidation", offer_id, scenario)

    def _read(
        self,
        operation: Literal["search", "detail", "revalidation"],
        offer_id: str | None,
        scenario: ReadScenario,
    ) -> ReadEvidence:
        self.counters[operation] += 1
        checked_at = self._now()
        selected = (
            ((self.quote(offer_id),) if offer_id else SYNTHETIC_OFFERS)
            if scenario == "success" else ()
        )
        status: ReadStatus = (
            (selected[0].status if selected else "no_matches")
            if scenario == "success" else scenario
        )
        expiry = checked_at + timedelta(minutes=5) if selected else None
        return ReadEvidence(
            status, selected,
            checked_at.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            expiry.isoformat(timespec="milliseconds").replace("+00:00", "Z") if expiry else None,
            f"synthetic-{operation}-{self.counters[operation]}",
        )

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
        self.counters["write_attempts"] += 1
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
        self.counters["writes"] += 1
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