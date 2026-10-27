import asyncio
from copy import deepcopy
from datetime import UTC, datetime
from typing import cast

import pytest

from onholidai_agent.api.store import RunStore
from onholidai_agent.graph.estimate import estimate
from onholidai_agent.integrations.nebius import NebiusClient
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.models.api import CreateAgentRunRequest
from tests.fixtures.planning import complete_component_facts, quoted_offers


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


class QuotedSources(Sources):
    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]:
        return {"offers": quoted_offers(query)}


def test_missing_origin_asks_before_flight_research():
    sources = Sources(False)
    result = asyncio.run(estimate(request(), sources, now=datetime(2029, 1, 1, tzinfo=UTC)))
    assert result.root.kind == "clarification"
    assert sources.searches == 0


def test_source_failure_preserves_preferred_dates_and_never_returns_zero_cost_success():
    sources = Sources()
    original = deepcopy(sources.trip)
    with pytest.raises(ValueError, match="source_unavailable"):
        asyncio.run(estimate(request(), sources))
    assert sources.trip == original
    assert sources.searches == 1


def test_alternative_supplier_quotes_are_not_added_together_as_booked_components():
    class Alternatives(Sources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            return {
                "offers": quoted_offers(
                    query,
                    (
                        ("flight", 10000),
                        ("flight", 20000),
                        ("accommodation", 10000),
                        ("accommodation", 20000),
                    ),
                )
            }

    sources = Alternatives()
    result = asyncio.run(estimate(request(), sources)).root
    assert result.kind == "proposal"
    operation = next(item for item in result.proposal.operations if item.target == "/components")
    selected = cast(list[dict[str, object]], operation.value)
    assert len(selected) == 2
    assert {item["type"] for item in selected} == {"flight", "accommodation"}


def test_departure_comparison_proposes_the_supported_cheaper_origin_without_changing_the_trip():
    class OriginAlternatives(Sources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            price = 5000 if query.get("departurePlaceId") == "ams" else 10000
            return {"offers": quoted_offers(query, (("flight", price), ("accommodation", price)))}

    source = OriginAlternatives()
    snapshot = cast(dict[str, object], source.trip["snapshot"])
    snapshot["departureOrigin"] = {"placeId": "lhr", "name": "London", "confirmedByUser": True}
    snapshot["departureOrigins"] = [
        snapshot["departureOrigin"],
        {"placeId": "ams", "name": "Amsterdam", "confirmedByUser": True},
    ]
    before = deepcopy(source.trip)
    result = asyncio.run(estimate(request(), source)).root
    assert result.kind == "proposal"
    origin = next(
        operation
        for operation in result.proposal.operations
        if operation.target == "/departureOrigin"
    )
    assert cast(dict[str, object], origin.value)["placeId"] == "ams"
    assert "Compared 2 departure alternatives" in result.proposal.rationale
    assert source.trip == before


def test_ai_estimate_proposes_origin_aware_order_for_review_without_changing_saved_order():
    class RouteSources(QuotedSources):
        def __init__(self):
            super().__init__()
            self.search_queries: list[dict[str, object]] = []

        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            self.search_queries.append(query)
            return await super().search(request, query)

    source = RouteSources()
    snapshot = cast(dict[str, object], source.trip["snapshot"])
    west = {
        "placeId": "home-west",
        "name": "West",
        "confirmedByUser": True,
        "location": {"latitude": 0, "longitude": 0},
    }
    east = {
        "placeId": "home-east",
        "name": "East",
        "confirmedByUser": True,
        "location": {"latitude": 20, "longitude": 20},
    }
    stops = [
        {
            "id": f"10000000-0000-4000-8000-{index:012}",
            "name": name,
            "kind": "city",
            "location": {"latitude": 0, "longitude": longitude},
            "routePosition": index,
            "arrivalDate": None,
            "departureDate": None,
            "plannedNights": 0,
        }
        for index, (name, longitude) in enumerate([("A", 0), ("C", 20), ("B", 10), ("D", 30)], 5)
    ]
    original_order = [stop["id"] for stop in stops]
    snapshot.update(
        {
            "departureOrigin": west,
            "departureOrigins": [west, east],
            "destinationOrder": "ai",
            "destinations": stops,
        }
    )
    before = deepcopy(source.trip)

    result = asyncio.run(estimate(request(), source)).root
    assert result.kind == "proposal"
    routed = next(
        operation.value
        for operation in result.proposal.operations
        if operation.target == "/destinations"
    )
    proposed_order = [stop["id"] for stop in cast(list[dict[str, object]], routed)]
    assert proposed_order != original_order
    assert len(source.search_queries) >= 2
    assert all(query["destinationIds"] == proposed_order for query in source.search_queries)
    assert "return to the same location" in result.proposal.rationale
    assert source.trip == before


def test_unavailable_baseline_does_not_hide_a_supported_departure_alternative():
    class PartialSources(QuotedSources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            if query.get("departurePlaceId") != "ams":
                return {"offers": []}
            return await super().search(request, query)

    source = PartialSources()
    snapshot = cast(dict[str, object], source.trip["snapshot"])
    snapshot["departureOrigin"] = {"placeId": "lhr", "name": "London", "confirmedByUser": True}
    snapshot["departureOrigins"] = [
        snapshot["departureOrigin"],
        {"placeId": "ams", "name": "Amsterdam", "confirmedByUser": True},
    ]
    result = asyncio.run(estimate(request(), source)).root
    assert result.kind == "proposal"
    assert "unavailable or not comparable" in result.proposal.rationale
    assert "Compared 1 departure alternatives" in result.proposal.rationale


def test_unavailable_advisory_model_still_returns_the_deterministic_estimate():
    class UnavailableModel:
        async def complete(self, messages: list[dict[str, str]]) -> str:
            raise TimeoutError()

    sources = EstimateSources(
        cast(RunStore, QuotedSources()), cast(NebiusClient, UnavailableModel())
    )
    result = asyncio.run(estimate(request(), sources)).root
    assert result.kind == "proposal"
    assert "Advisory model summary" not in result.proposal.rationale


def test_started_window_plans_the_remaining_days_instead_of_past_dates():
    class RemainingWindowSources(QuotedSources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            assert str(query["startDate"]) >= "2030-05-15"
            return await super().search(request, query)

    result = asyncio.run(
        estimate(request(), RemainingWindowSources(), now=datetime(2030, 5, 15, tzinfo=UTC))
    ).root
    assert result.kind == "proposal"
    routed = cast(
        list[dict[str, object]],
        next(
            operation.value
            for operation in result.proposal.operations
            if operation.target == "/destinations"
        ),
    )
    assert routed[0]["arrivalDate"] == "2030-05-15"
    assert routed[-1]["departureDate"] == "2030-05-20"
    assert "remaining availability window days" in result.proposal.rationale
    assert any("6 remaining days" in warning for warning in result.proposal.warnings)


def test_passed_window_asks_for_future_dates_before_searching():
    sources = Sources()
    result = asyncio.run(estimate(request(), sources, now=datetime(2030, 7, 1, tzinfo=UTC))).root
    assert result.kind == "clarification"
    assert "in the past" in result.clarification.question
    assert sources.searches == 0


def test_incomplete_live_pricing_reports_research_instead_of_failing():
    class IncompleteSources(Sources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            return {
                "offers": [
                    {
                        "component": {
                            **complete_component_facts("flight", query),
                            "id": "b0000000-b000-4000-8000-b000000000001",
                            "type": "flight",
                            "bookingStatus": "unbooked",
                            "price": {
                                "currency": "EUR",
                                "finalCustomerMinor": None,
                                "taxesMinor": 20716,
                                "feesMinor": None,
                            },
                        }
                    }
                ]
            }

    result = asyncio.run(estimate(request(), IncompleteSources())).root
    assert result.kind == "answer"
    assert "none established a complete customer price" in result.message
