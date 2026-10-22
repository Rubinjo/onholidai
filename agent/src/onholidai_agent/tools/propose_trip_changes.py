from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

from onholidai_agent.models.api import AgentResult, CreateAgentRunRequest
from onholidai_agent.tools.research import complete_planning_component


def propose_trip_changes(
    request: CreateAgentRunRequest,
    operations: list[dict[str, object]],
    rationale: str,
    warnings: list[str],
    now: datetime | None = None,
) -> AgentResult:
    for operation in operations:
        target = operation.get("target")
        if not isinstance(target, str) or not (
            target == "/components" or target.startswith("/components/")
        ):
            continue
        if operation.get("operation") == "remove":
            continue
        value = operation.get("value")
        components = cast(list[object], value) if isinstance(value, list) else [value]
        if target != "/components" or not all(
            complete_planning_component(component) for component in components
        ):
            return AgentResult.model_validate(
                {
                    "kind": "clarification",
                    "message": "Incomplete supplier facts cannot become accepted components.",
                    "clarification": {
                        "id": str(uuid4()),
                        "question": (
                            "Which complete, current supplier offer should be reviewed? "
                            "Missing prices, dates or terms remain unknown."
                        ),
                        "materialReason": "feasibility",
                    },
                }
            )
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
