from copy import deepcopy
from datetime import UTC, datetime

import pytest

from onholidai_agent.graph.estimate import estimate
from onholidai_agent.models.api import CreateAgentRunRequest


def request():
    return CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": "10000000-0000-4000-8000-000000000001",
            "conversationId": "10000000-0000-4000-8000-000000000002",
            "purpose": "initial_estimate",
            "actor": {
                "userId": "10000000-0000-4000-8000-000000000003",
                "tripId": "10000000-0000-4000-8000-000000000004",
                "baseTripVersion": 1,
                "scopes": ["trip:read", "proposal:create"],
            },
            "message": "Estimate reviewed settings",
            "context": {"tripSummary": {"version": 1}, "contextBudget": {"maximumTokens": 16000}},
        }
    )


class Sources:
    def __init__(self, origin: bool = True):
        self.searches = 0
        self.trip: dict[str, object] = {
            "version": 1,
            "snapshot": {
                "departureOrigin": {"confirmedByUser": True} if origin else None,
                "availabilityWindows": [
                    {"startDate": "2030-05-01", "endDate": "2030-05-20", "preference": "preferred"},
                    {"startDate": "2030-06-01", "endDate": "2030-06-20", "preference": "flexible"},
                ],
                "duration": {"minimumDays": 5, "idealDays": 7, "maximumDays": 8},
                "destinations": [
                    {"id": "10000000-0000-4000-8000-000000000005", "name": "Tokyo", "kind": "city"}
                ],
                "constraints": [],
                "preferences": {"pace": 50},
                "price": {"currency": "EUR"},
            },
        }

    async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
        return self.trip

    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]:
        self.searches += 1
        return {"offers": [], "outcomes": [{"status": "unavailable"}]}


def test_missing_origin_asks_before_flight_research():
    import asyncio

    sources = Sources(False)
    result = asyncio.run(estimate(request(), sources, now=datetime(2029, 1, 1, tzinfo=UTC)))
    assert result.root.kind == "clarification"
    assert sources.searches == 0


def test_source_failure_preserves_preferred_dates_and_never_returns_zero_cost_success():
    import asyncio

    sources = Sources()
    original = deepcopy(sources.trip)
    with pytest.raises(ValueError, match="source_unavailable"):
        asyncio.run(estimate(request(), sources))
    assert sources.trip == original
    assert sources.searches == 1


def test_alternative_supplier_quotes_are_not_added_together_as_booked_components():
    import asyncio
    from typing import cast

    class Alternatives(Sources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            return {
                "offers": [
                    {
                        "component": {
                            "id": f"a0000000-a000-4000-8000-a{index:011}",
                            "type": kind,
                            "bookingStatus": "unbooked",
                            "price": {"currency": "EUR", "finalCustomerMinor": price},
                        }
                    }
                    for index, (kind, price) in enumerate(
                        (
                            ("flight", 10000),
                            ("flight", 20000),
                            ("accommodation", 10000),
                            ("accommodation", 20000),
                        ),
                        1,
                    )
                ]
            }

    sources = Alternatives()
    result = asyncio.run(estimate(request(), sources)).root
    assert result.kind == "proposal"
    operation = next(item for item in result.proposal.operations if item.target == "/components")
    selected = cast(list[dict[str, object]], operation.value)
    assert len(selected) == 2
    assert {item["type"] for item in selected} == {"flight", "accommodation"}
