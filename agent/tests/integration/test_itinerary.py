import asyncio
from copy import deepcopy
from typing import Any, cast
from uuid import uuid4

from onholidai_agent.graph.finalize import compose_itinerary
from onholidai_agent.graph.refine import compose_refinement
from onholidai_agent.models.api import CreateAgentRunRequest


def test_itinerary_is_a_reviewable_proposal_and_preserves_authoritative_choices():
    snapshot: dict[str, Any] = {
        "destinations": [
            {
                "id": str(uuid4()),
                "name": "Lisbon",
                "timezone": "Europe/Lisbon",
                "arrivalDate": "2030-05-01",
                "departureDate": "2030-05-02",
                "plannedNights": 1,
                "location": None,
            }
        ],
        "preferences": {"pace": 25, "discovery": 70, "setting": 50, "independence": 50},
        "constraints": [],
        "components": [],
    }
    before = deepcopy(snapshot)

    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {"version": 2, "snapshot": snapshot}

    request = CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": str(uuid4()),
            "purpose": "finalization",
            "conversationId": str(uuid4()),
            "actor": {
                "userId": str(uuid4()),
                "tripId": str(uuid4()),
                "baseTripVersion": 2,
                "scopes": ["trip:read", "proposal:create"],
            },
            "message": "Prepare detailed itinerary",
            "context": {"tripSummary": {"version": 2}, "contextBudget": {"maximumTokens": 16000}},
        }
    )
    result = asyncio.run(compose_itinerary(request, Reader())).root
    assert result.kind == "proposal"
    assert result.proposal.purpose == "finalization"
    assert [operation.target for operation in result.proposal.operations] == ["/itineraryDays"]
    assert snapshot == before
    days = cast("list[dict[str, Any]]", result.proposal.operations[0].value)
    assert len(days) == 2
    for day in days:
        assert sum(item["type"] == "meal" for item in day["items"]) >= 2
        assert any(item["type"] == "free_time" for item in day["items"])
        assert all(item["verificationStatus"] == "unverified" for item in day["items"])


def planning_request(message: str, purpose: str = "refinement") -> CreateAgentRunRequest:
    return CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": str(uuid4()),
            "conversationId": str(uuid4()),
            "purpose": purpose,
            "message": message,
            "actor": {
                "userId": str(uuid4()),
                "tripId": str(uuid4()),
                "baseTripVersion": 2,
                "scopes": ["trip:read", "proposal:create"],
            },
            "context": {"tripSummary": {"version": 2}, "contextBudget": {"maximumTokens": 16000}},
        }
    )


def test_missing_timezone_requires_clarification_without_inventing_one():
    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {
                "version": 2,
                "snapshot": {
                    "destinations": [{"id": str(uuid4()), "name": "Paris"}],
                    "preferences": {},
                    "components": [],
                },
            }

    result = asyncio.run(
        compose_itinerary(planning_request("Prepare itinerary", "finalization"), Reader())
    ).root
    assert result.kind == "clarification"
    assert "timezone" in result.clarification.question


def test_lower_priority_activity_changes_are_proposals_and_preserve_supplier_items():
    activity_id = str(uuid4())
    snapshot: dict[str, Any] = {
        "destinations": [],
        "preferences": {},
        "constraints": [],
        "components": [],
        "itineraryDays": [
            {
                "date": "2030-05-01",
                "timezone": "Europe/Lisbon",
                "items": [
                    {
                        "id": activity_id,
                        "type": "activity",
                        "componentId": None,
                        "start": "2030-05-01T10:00",
                        "end": "2030-05-01T12:00",
                    }
                ],
            }
        ],
    }

    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {"version": 2, "snapshot": snapshot}

    for message, count in [
        (f"Remove activity {activity_id}", 0),
        (f"Move activity {activity_id} to 2030-05-01 at 14:00", 1),
    ]:
        before = deepcopy(snapshot)
        result = asyncio.run(compose_refinement(planning_request(message), Reader())).root
        assert result.kind == "proposal"
        days = cast("list[dict[str, Any]]", result.proposal.operations[0].value)
        assert len(days[0]["items"]) == count
        assert snapshot == before
    snapshot["itineraryDays"][0]["items"][0]["componentId"] = str(uuid4())
    result = asyncio.run(
        compose_refinement(planning_request(f"Remove activity {activity_id}"), Reader())
    ).root
    assert result.kind == "clarification"
