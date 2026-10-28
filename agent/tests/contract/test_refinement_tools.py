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
        self.trip: dict[str, object] = {
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


def test_preference_rationale_uses_public_scale_without_changing_legacy_operations():
    result = asyncio.run(refine(refinement_request("Set pace to 25"), RefinementSource()))
    assert result.root.kind == "proposal"
    assert result.root.proposal.operations[0].value == 25
    assert "3/10" in result.root.proposal.rationale
    assert "/100" not in result.root.proposal.rationale


def test_stated_nights_per_stop_proposes_the_whole_dated_route():
    sources = RefinementSource()
    before = deepcopy(sources.trip)
    result = asyncio.run(
        refine(
            refinement_request("I want to spend 4 nights in Tokyo and only 2 nights in Kyoto."),
            sources,
        )
    )
    assert result.root.kind == "proposal"
    operation = result.root.proposal.operations[0]
    assert operation.target == "/destinations"
    routed = [cast(dict[str, object], entry) for entry in cast(list[object], operation.value)]
    assert [
        (entry["plannedNights"], entry["arrivalDate"], entry["departureDate"]) for entry in routed
    ] == [(4, "2030-05-01", "2030-05-05"), (2, "2030-05-05", "2030-05-07")]
    assert sources.trip == before


def test_partial_nights_statement_keeps_the_saved_nights_for_other_stops():
    result = asyncio.run(refine(refinement_request("Spend 4 nights in Tokyo"), RefinementSource()))
    assert result.root.kind == "proposal"
    routed = cast(list[dict[str, object]], result.root.proposal.operations[0].value)
    assert [(entry["plannedNights"], entry["departureDate"]) for entry in routed] == [
        (4, "2030-05-05"),
        (3, "2030-05-08"),
    ]


def test_nights_split_inside_the_recorded_window_proposes_without_a_question():
    result = asyncio.run(
        refine(refinement_request("5 nights in Tokyo and 2 nights in Kyoto"), RefinementSource())
    )
    assert result.root.kind == "proposal"
    assert "8 days" in result.root.proposal.rationale


def test_request_to_fit_flights_and_stays_to_a_stated_split_proposes_the_route():
    result = asyncio.run(
        refine(
            refinement_request(
                "Adjust the flights and accommodation to fit 4 nights in Tokyo and "
                "2 nights in Kyoto."
            ),
            RefinementSource(),
        )
    )
    assert result.root.kind == "proposal"
    operation = result.root.proposal.operations[0]
    assert operation.target == "/destinations"
    routed = [cast(dict[str, object], entry) for entry in cast(list[object], operation.value)]
    assert [entry["plannedNights"] for entry in routed] == [4, 2]
    assert "7 days" in result.root.proposal.rationale


def test_worded_nights_are_read_like_digits():
    result = asyncio.run(
        refine(
            refinement_request("four nights in Tokyo and two nights in Kyoto"), RefinementSource()
        )
    )
    assert result.root.kind == "proposal"
    routed = cast(list[dict[str, object]], result.root.proposal.operations[0].value)
    assert [entry["plannedNights"] for entry in routed] == [4, 2]


def test_stop_the_traveller_did_not_mention_keeps_its_saved_nights():
    sources = RefinementSource()
    snapshot = cast(dict[str, object], sources.trip["snapshot"])
    destinations = cast(list[dict[str, object]], snapshot["destinations"])
    destinations.append(
        {
            "id": "10000000-0000-4000-8000-000000000007",
            "name": "Osaka",
            "plannedNights": 2,
            "arrivalDate": "2030-05-07",
            "departureDate": "2030-05-09",
            "routePosition": 2,
        }
    )
    cast(dict[str, object], snapshot["duration"])["maximumDays"] = 12
    before = deepcopy(sources.trip)
    result = asyncio.run(
        refine(
            refinement_request("4 nights in Tokyo and 2 nights in Osaka"),
            sources,
        )
    )
    assert result.root.kind == "proposal"
    routed = cast(list[dict[str, object]], result.root.proposal.operations[0].value)
    assert [entry["plannedNights"] for entry in routed] == [4, 3, 2]
    assert sources.trip == before


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
