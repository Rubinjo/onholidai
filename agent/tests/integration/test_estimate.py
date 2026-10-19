from copy import deepcopy
from datetime import UTC, datetime

import pytest

from onholidai_agent.graph.estimate import estimate
from onholidai_agent.models.api import CreateAgentRunRequest
from tests.fixtures.planning import complete_component_facts


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
                            **complete_component_facts(kind),
                            "id": f"a0000000-a000-4000-8000-a{index:011}",
                            "type": kind,
                            "bookingStatus": "unbooked",
                            "price": {"currency": "EUR", "finalCustomerMinor": price,
                                      "taxesMinor": 0, "feesMinor": 0},
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


def test_departure_comparison_proposes_the_supported_cheaper_origin_without_changing_the_trip():
    import asyncio
    from typing import cast

    class OriginAlternatives(Sources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            price = 5000 if query.get("departurePlaceId") == "ams" else 10000
            return {
                "offers": [
                    {
                        "component": {
                            **complete_component_facts(kind),
                            "id": f"a0000000-a000-4000-8000-a{index:011}",
                            "type": kind,
                            "bookingStatus": "unbooked",
                            "price": {"currency": "EUR", "finalCustomerMinor": price,
                                      "taxesMinor": 0, "feesMinor": 0},
                        }
                    }
                    for index, kind in enumerate(["flight", "accommodation"], 1)
                ]
            }

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
    import asyncio
    from typing import cast

    class RouteSources(Sources):
        def __init__(self):
            super().__init__()
            self.search_queries: list[dict[str, object]] = []

        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            self.search_queries.append(query)
            return {
                "offers": [
                    {
                        "component": {
                            **complete_component_facts(kind),
                            "id": f"a0000000-a000-4000-8000-a{index:011}",
                            "type": kind,
                            "bookingStatus": "unbooked",
                            "price": {"currency": "EUR", "finalCustomerMinor": 10000,
                                      "taxesMinor": 0, "feesMinor": 0},
                        }
                    }
                    for index, kind in enumerate(["flight", "accommodation"], 1)
                ]
            }

    source = RouteSources()
    snapshot = cast(dict[str, object], source.trip["snapshot"])
    west = {"placeId": "home-west", "name": "West", "confirmedByUser": True,
            "location": {"latitude": 0, "longitude": 0}}
    east = {"placeId": "home-east", "name": "East", "confirmedByUser": True,
            "location": {"latitude": 20, "longitude": 20}}
    stops = [
        {"id": f"10000000-0000-4000-8000-{index:012}", "name": name, "kind": "city",
         "location": {"latitude": 0, "longitude": longitude}, "routePosition": index,
         "arrivalDate": None, "departureDate": None, "plannedNights": 0}
        for index, (name, longitude) in enumerate(
            [("A", 0), ("C", 20), ("B", 10), ("D", 30)], 5
        )
    ]
    original_order = [stop["id"] for stop in stops]
    snapshot.update({
        "departureOrigin": west,
        "departureOrigins": [west, east],
        "destinationOrder": "ai",
        "destinations": stops,
    })
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
    import asyncio
    from typing import cast

    class PartialSources(Sources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            if query.get("departurePlaceId") != "ams":
                return {"offers": []}
            return {
                "offers": [
                    {
                        "component": {
                            **complete_component_facts(kind),
                            "id": f"a0000000-a000-4000-8000-a{index:011}",
                            "type": kind,
                            "bookingStatus": "unbooked",
                            "price": {"currency": "EUR", "finalCustomerMinor": 10000,
                                      "taxesMinor": 0, "feesMinor": 0},
                        }
                    }
                    for index, kind in enumerate(["flight", "accommodation"], 1)
                ]
            }

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
