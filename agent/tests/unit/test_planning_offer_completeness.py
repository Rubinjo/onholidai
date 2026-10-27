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
    assert result.kind == "clarification"
    assert "Rail inventory is unsupported" in result.clarification.question
    assert "remains unresolved" in result.clarification.question
    assert result.clarification.question.count("?") == 1
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
            flight = offer()
            cast(dict[str, object], flight["component"]).update(
                complete_component_facts("flight", query)
            )
            return {"offers": [flight, incomplete]}

    result = asyncio.run(estimate(request(), IncompleteSources())).root
    assert result.kind == "answer"
    assert "Useful supplier research" in result.message
    assert "remain unknown" in result.message


def test_explicit_rail_deferral_continues_supported_planning_without_waiving_the_requirement():
    class SupportedSources(Sources):
        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            values: list[dict[str, object]] = []
            for kind in ("flight", "accommodation"):
                value = offer(kind)
                cast(dict[str, object], value["component"]).update(
                    complete_component_facts(kind, query)
                )
                value.update(
                    eligibility={"status": "eligible"},
                    occupancy={"maximumAdults": 10, "maximumChildren": 10},
                )
                values.append(value)
            return {
                "offers": values,
                "outcomes": [{"componentType": "rail", "status": "unsupported"}],
            }

    source = SupportedSources()
    cast(dict[str, object], source.trip["snapshot"])["constraints"] = [
        {
            "category": "transport",
            "priority": "required",
            "statement": "Use rail between destinations",
            "status": "active",
        }
    ]
    before = deepcopy(source.trip)
    result = asyncio.run(
        estimate(
            request().model_copy(
                update={"message": "Keep rail unresolved while planning the supported parts"}
            ),
            source,
        )
    ).root
    assert result.kind == "proposal"
    assert any(
        "Required rail remains unresolved" in warning for warning in result.proposal.warnings
    )
    assert not any(operation.target == "/constraints" for operation in result.proposal.operations)
    assert source.trip == before


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


def test_unknown_supplier_fee_lines_keep_the_authoritative_total_proposable():
    # Live suppliers publish an authoritative payable total but not always a fee
    # breakdown. The breakdown stays null (backend record) while the offer is usable.
    offer_without_breakdown = offer()
    component = cast(dict[str, object], offer_without_breakdown["component"])
    price = cast(dict[str, object], component["price"])
    price["taxesMinor"] = None
    price["feesMinor"] = None
    assert select_quotes([offer_without_breakdown], 50) == [offer_without_breakdown]
    result = propose_trip_changes(
        request().model_copy(update={"purpose": "refinement"}),
        [
            {
                "operation": "replace",
                "target": "/components",
                "value": [offer_without_breakdown["component"]],
            }
        ],
        "Live totals with an unverified fee breakdown",
        [],
    )
    assert result.root.kind == "proposal"
    stored = cast(list[dict[str, object]], result.root.proposal.operations[0].value)[0]
    # The draft contract omits an unknown breakdown instead of carrying a null, so the
    # saved component keeps only the authoritative total.
    stored_price = cast(dict[str, object], stored["price"])
    assert "feesMinor" not in stored_price
    assert stored_price["finalCustomerMinor"] == 10000


def test_discovery_offer_with_bounded_facts_and_unverified_terms_is_proposable():
    # Live discovery offers keep `details` empty and carry the sourced facts in
    # planningDetails; unverified terms/fees stay recorded in unverifiedFacts.
    discovery = offer()
    component = cast(dict[str, object], discovery["component"])
    component["details"] = None
    component["cancellationTerms"] = None
    component["planningDetails"] = {
        "locationName": "Tokyo",
        "timezone": None,
        "airportNames": [],
        "airlines": [],
        "flightDirection": None,
        "durationMinutes": None,
        "layovers": [],
        "fareConditions": '{"segmentCount":2}',
        "accommodationType": None,
        "travelFromStayMinutes": None,
        "eligibility": "unverified",
        "accessibility": "unverified",
        "availability": "unverified",
        "constraintEvidence": [],
        "source": "Duffel Flights",
        "checkedAt": "2030-04-01T00:00:00Z",
        "unavailableFacts": ["Complete service details"],
    }
    discovery["unverifiedFacts"] = ["terms", "fees"]
    assert select_quotes([discovery], 50) == [discovery]
