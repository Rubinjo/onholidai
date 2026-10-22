import asyncio
from copy import deepcopy
from typing import cast

import pytest

from onholidai_agent.graph.estimate import estimate, select_quotes
from onholidai_agent.models.api import CreateAgentRunRequest
from onholidai_agent.tools.propose_trip_changes import propose_trip_changes
from tests.fixtures.planning import complete_component_facts
from tests.integration.test_estimate import Sources, request


def offer(kind: str = "flight") -> dict[str, object]:
    return {
        "component": {
            **complete_component_facts(kind),
            "id": "10000000-0000-4000-8000-000000000010",
            "type": kind,
            "bookingStatus": "unbooked",
            "price": {
                "currency": "EUR",
                "finalCustomerMinor": 10000,
                "taxesMinor": 0,
                "feesMinor": 0,
            },
        }
    }


@pytest.mark.parametrize(
    "field",
    [
        "serviceStart",
        "serviceEnd",
        "details",
        "cancellationTerms",
        "price",
        "price.finalCustomerMinor",
        "price.taxesMinor",
        "price.feesMinor",
    ],
)
def test_incomplete_discovery_facts_are_not_selected_or_proposed(field: str):
    incomplete = offer()
    component = cast(dict[str, object], incomplete["component"])
    if field.startswith("price."):
        cast(dict[str, object], component["price"])[field.split(".")[1]] = None
    else:
        component[field] = None
    before = deepcopy(incomplete)
    assert select_quotes([incomplete, offer()], 0) == [offer()]
    assert select_quotes([incomplete], 50) == []
    result = propose_trip_changes(
        request().model_copy(update={"purpose": "refinement"}),
        [{"operation": "replace", "target": "/components", "value": [component]}],
        "A model suggested incomplete inventory",
        [],
    )
    assert result.root.kind == "clarification"
    assert incomplete == before


def test_unsupported_rail_keeps_supported_planning_and_requirement_unresolved():
    class MixedSources(Sources):
        async def search(
            self,
            request: CreateAgentRunRequest,
            query: dict[str, object],
        ) -> dict[str, object]:
            return {
                "offers": [offer(kind) for kind in ("flight", "accommodation", "activity")],
                "outcomes": [
                    {"componentType": kind, "provider": provider, "status": "available"}
                    for kind, provider in (
                        ("flight", "duffel"),
                        ("accommodation", "duffel"),
                        ("activity", "viator"),
                    )
                ]
                + [{"componentType": "rail", "status": "unsupported"}],
            }

    sources = MixedSources()
    snapshot = cast(dict[str, object], sources.trip["snapshot"])
    snapshot["constraints"] = [
        {
            "priority": "required",
            "statement": "Use rail between destinations",
            "status": "unverified",
        }
    ]
    before = deepcopy(sources.trip)
    result = asyncio.run(estimate(request(), sources)).root
    assert result.kind == "proposal"
    components = next(
        operation.value
        for operation in result.proposal.operations
        if operation.target == "/components"
    )
    assert {component["type"] for component in cast(list[dict[str, object]], components)} == {
        "flight",
        "accommodation",
        "activity",
    }
    assert any(
        "rail" in warning and "unsupported" in warning for warning in result.proposal.warnings
    )
    assert any(
        "Unverified required requirement: Use rail" in warning
        for warning in result.proposal.warnings
    )
    assert sources.trip == before


def test_only_incomplete_required_inventory_cannot_create_zero_cost_proposal():
    class IncompleteSources(Sources):
        async def search(
            self,
            request: CreateAgentRunRequest,
            query: dict[str, object],
        ) -> dict[str, object]:
            incomplete = offer("accommodation")
            cast(dict[str, object], incomplete["component"])["price"] = None
            return {"offers": [offer(), incomplete]}

    with pytest.raises(ValueError, match="source_unavailable"):
        asyncio.run(estimate(request(), IncompleteSources()))


@pytest.mark.parametrize("availability", ["unknown", "unavailable"])
def test_unknown_or_unavailable_evidence_does_not_become_component(availability: str):
    value = offer()
    value["evidence"] = {"status": "quoted", "availability": availability}
    assert select_quotes([value], 50) == []


def test_expired_quotes_and_missing_component_dates_are_not_materialized():
    expired = offer()
    expired["evidence"] = {"status": "expired", "availability": "available"}
    missing = offer()
    del cast(dict[str, object], missing["component"])["serviceStart"]
    assert select_quotes([expired, missing], 50) == []
