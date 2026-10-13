from datetime import UTC, datetime, timedelta
from uuid import uuid4

from onholidai_agent.models.api import AgentResult, CreateAgentRunRequest


def propose_trip_changes(
    request: CreateAgentRunRequest,
    operations: list[dict[str, object]],
    rationale: str,
    warnings: list[str],
    now: datetime | None = None,
) -> AgentResult:
    timestamp = now or datetime.now(UTC)
    return AgentResult.model_validate(
        {
            "kind": "proposal",
            "message": "Review this estimated draft before accepting.",
            "proposal": {
                "id": str(uuid4()),
                "purpose": request.purpose,
                "initiatingRequestId": request.request_id,
                "baseTripVersion": request.actor.base_trip_version,
                "operations": operations,
                "affectedFacts": [
                    "route",
                    "transport",
                    "accommodation",
                    "activities",
                    "estimated_price",
                ],
                "rationale": rationale,
                "tradeoffs": ["Availability and all prices remain estimated until revalidation."],
                "warnings": warnings[:64],
                "expiresAt": (timestamp + timedelta(minutes=15)).isoformat().replace("+00:00", "Z"),
            },
        }
    )
