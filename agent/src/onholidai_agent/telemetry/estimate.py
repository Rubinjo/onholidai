from dataclasses import dataclass


@dataclass(frozen=True)
class EstimateMeasurement:
    outcome: str
    elapsed_ms: float
    clarification_wait_ms: float
    required_count: int
    accounted_count: int

    def safe_payload(self) -> dict[str, str | float | int]:
        if self.outcome not in {"proposed", "failed", "clarification"}:
            raise ValueError("invalid_estimate_outcome")
        if self.clarification_wait_ms > self.elapsed_ms:
            raise ValueError("invalid_clarification_wait")
        if (
            min(
                self.elapsed_ms,
                self.clarification_wait_ms,
                self.required_count,
                self.accounted_count,
            )
            < 0
            or self.accounted_count > self.required_count
        ):
            raise ValueError("invalid_estimate_measurement")
        return {
            "outcome": self.outcome,
            "duration_ms": self.elapsed_ms - self.clarification_wait_ms,
            "required_count": self.required_count,
            "accounted_count": self.accounted_count,
        }


def failure_inclusive_success_rate(measurements: list[EstimateMeasurement]) -> float:
    if not measurements:
        raise ValueError("empty_evaluation_denominator")
    return sum(
        item.outcome == "proposed" and item.elapsed_ms - item.clarification_wait_ms <= 30000
        for item in measurements
    ) / len(measurements)
