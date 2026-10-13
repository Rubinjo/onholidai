import asyncio
from copy import deepcopy
from typing import cast

import pytest
from pydantic import ValidationError

from onholidai_agent.graph.refine import refine
from onholidai_agent.models.api import CreateAgentRunRequest
from onholidai_agent.models.tools import RetrieveRelevantContextInput


def refinement_request(message: str) -> CreateAgentRunRequest:
    return CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": "10000000-0000-4000-8000-000000000001",
            "conversationId": "10000000-0000-4000-8000-000000000002",
            "purpose": "refinement",
            "actor": {
                "userId": "10000000-0000-4000-8000-000000000003",
                "tripId": "10000000-0000-4000-8000-000000000004",
                "baseTripVersion": 2,
                "scopes": ["trip:read", "context:read", "proposal:create"],
            },
            "message": message,
            "context": {"tripSummary": {"version": 2}, "contextBudget": {"maximumTokens": 24000}},
        }
    )


class RefinementSource:
    def __init__(self):
        self.trip = {
            "version": 2,
            "snapshot": {
                "destinations": [
                    {
                        "id": "10000000-0000-4000-8000-000000000005",
                        "name": "Tokyo",
                        "plannedNights": 3,
                        "arrivalDate": "2030-05-01",
                        "departureDate": "2030-05-04",
                        "routePosition": 0,
                    },
                    {
                        "id": "10000000-0000-4000-8000-000000000006",
                        "name": "Kyoto",
                        "plannedNights": 3,
                        "arrivalDate": "2030-05-04",
                        "departureDate": "2030-05-07",
                        "routePosition": 1,
                    },
                ],
                "duration": {"minimumDays": 5, "idealDays": 7, "maximumDays": 12},
                "constraints": [],
                "preferences": {"pace": 50},
            },
        }

    async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
        return self.trip


def test_add_two_nights_proposes_exact_schedule_without_mutation():
    sources = RefinementSource()
    before = deepcopy(sources.trip)
    result = asyncio.run(refine(refinement_request("Add two nights in Kyoto"), sources))
    assert result.root.kind == "proposal"
    assert result.root.proposal.purpose == "refinement"
    routed = result.root.proposal.operations[0].value
    assert isinstance(routed, list)
    entry = cast(dict[str, object], routed[1])
    assert entry["plannedNights"] == 5
    assert entry["departureDate"] == "2030-05-09"
    assert sources.trip == before


@pytest.mark.parametrize(
    "message", ["book it", "cancel my flight", "reschedule my booking", "pay for the trip"]
)
def test_consequential_requests_only_return_separate_ui_guidance(message: str):
    result = asyncio.run(refine(refinement_request(message), RefinementSource()))
    assert result.root.kind == "answer"
    assert "separate" in result.root.message


def test_ambiguity_asks_one_question():
    result = asyncio.run(refine(refinement_request("Add two nights there"), RefinementSource()))
    assert result.root.kind == "clarification"
    assert result.root.clarification.question.count("?") == 1


@pytest.mark.parametrize(
    "fields",
    [
        {"limit": 0},
        {"limit": 21},
        {"query": "x" * 501},
        {"reason": "x" * 501},
        {"entityIds": ["10000000-0000-4000-8000-000000000001"] * 33},
    ],
)
def test_retrieval_limits(fields: dict[str, object]):
    with pytest.raises(ValidationError):
        RetrieveRelevantContextInput.model_validate(
            {"query": "Kyoto", "reason": "Recover prior rejected choice", "limit": 20, **fields}
        )
