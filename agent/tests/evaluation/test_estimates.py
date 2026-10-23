import asyncio
import json
from copy import deepcopy
from pathlib import Path
from time import perf_counter
from typing import cast

import pytest

from onholidai_agent.graph.estimate import MaterialChoice, estimate, select_quotes
from onholidai_agent.models.api import CreateAgentRunRequest
from tests.fixtures.planning import complete_component_facts


def test_high_spend_is_not_evidence_that_an_equivalent_expensive_offer_is_better():
    corpus = json.loads((Path(__file__).parents[1] / "fixtures/evaluation-corpus.json").read_text())
    offers = corpus["decisions"][0]["offers"]
    assert (
        cast(dict[str, object], select_quotes(offers, 100)[0]["component"])["supplierOfferId"]
        == "a"
    )


def test_all_frozen_supplier_decisions_meet_sc003_without_mutating_evidence():
    corpus = json.loads((Path(__file__).parents[1] / "fixtures/evaluation-corpus.json").read_text())
    cases = corpus["decisions"]
    failures: list[str] = []
    for case in cases:
        before = deepcopy(case)
        try:
            selected = select_quotes(
                case["offers"],
                case["input"]["snapshot"]["preferences"]["spend"],
                snapshot=case["input"]["snapshot"],
                query=case["query"],
            )
            passed = (
                case["expected"]["kind"] == "selection"
                and len(selected) == 1
                and cast(dict[str, object], selected[0]["component"])["supplierOfferId"]
                == case["expected"]["supplierOfferId"]
            )
        except MaterialChoice as error:
            focus = (
                "terms"
                if "competitive" in case["id"]
                else (
                    "budget"
                    if case["id"] == "budget-unknown"
                    else ("rail" if case["id"] == "rail-required" else "evidence")
                )
            )
            passed = (
                case["expected"]["kind"] == "clarification"
                and str(error).count("?") == 1
                and focus in str(error).lower()
            )
        if not passed:
            failures.append(case["id"])
        assert case == before
    assert len(cases) == 26
    assert not failures, failures


def decision_case():
    return json.loads((Path(__file__).parents[1] / "fixtures/evaluation-corpus.json").read_text())[
        "decisions"
    ][0]


def test_material_planning_facts_cannot_be_ignored_when_claiming_equivalence():
    case = decision_case()
    for offer, location in zip(
        case["offers"], ("Near the station", "Outside the city"), strict=True
    ):
        offer["component"]["planningDetails"] = {"locationName": location}
    with pytest.raises(MaterialChoice, match="terms"):
        select_quotes(case["offers"], 95, snapshot=case["input"]["snapshot"], query=case["query"])


@pytest.mark.parametrize("minimum,maximum", [(13, None), (None, 10)])
def test_child_age_bounds_override_an_inconsistent_eligible_label(
    minimum: int | None, maximum: int | None
):
    case = decision_case()
    case["input"]["snapshot"]["travellerParty"]["children"] = [{"ageAtTripStart": 12}]
    case["offers"][1]["eligibility"].update(minimumAge=minimum, maximumAge=maximum)
    selected = select_quotes(
        case["offers"], 95, snapshot=case["input"]["snapshot"], query=case["query"]
    )
    assert cast(dict[str, object], selected[0]["component"])["supplierOfferId"] == "b"


def test_unknown_evidence_for_one_required_group_is_not_hidden_by_another_group_of_the_same_type():
    case = decision_case()
    case["input"]["snapshot"]["constraints"] = [
        {
            "id": "step-free",
            "category": "accessibility",
            "priority": "required",
            "status": "active",
        }
    ]
    case["offers"][0]["selectionGroup"] = "flight:outbound"
    case["offers"][1]["selectionGroup"] = "flight:return"
    case["offers"][1]["accessibility"] = "unverified"
    with pytest.raises(MaterialChoice, match="evidence"):
        select_quotes(case["offers"], 95, snapshot=case["input"]["snapshot"], query=case["query"])


def test_expired_evidence_is_not_selected_even_when_the_status_label_is_still_quoted():
    case = decision_case()
    case["offers"][1]["evidence"]["expiresAt"] = "2000-01-01T00:00:00Z"
    selected = select_quotes(
        case["offers"], 95, snapshot=case["input"]["snapshot"], query=case["query"]
    )
    assert cast(dict[str, object], selected[0]["component"])["supplierOfferId"] == "b"


def test_a_required_flight_schedule_cannot_be_ignored_as_an_activity_only_constraint():
    case = decision_case()
    case["input"]["snapshot"]["constraints"] = [
        {
            "id": "arrival-time",
            "category": "schedule",
            "priority": "required",
            "statement": "Flights must arrive after 10:00",
            "status": "active",
        }
    ]
    for offer, status in zip(case["offers"], ("verified", "failed"), strict=True):
        offer["component"]["planningDetails"] = {
            "constraintEvidence": [{"constraintId": "arrival-time", "status": status}],
        }
    selected = select_quotes(
        case["offers"], 95, snapshot=case["input"]["snapshot"], query=case["query"]
    )
    assert cast(dict[str, object], selected[0]["component"])["supplierOfferId"] == "b"


def test_frozen_100_estimates_execute_real_graph_with_failure_inclusive_denominator():
    corpus = json.loads((Path(__file__).parents[1] / "fixtures/evaluation-corpus.json").read_text())
    cases = cast(list[dict[str, object]], corpus["estimates"])
    outcomes: list[bool] = []
    durations: list[float] = []
    required_accounted: list[bool] = []

    class Sources:
        def __init__(self, trip: dict[str, object]):
            self.trip = trip

        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return deepcopy(self.trip)

        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            return {
                "offers": [
                    {
                        "component": {
                            **complete_component_facts(kind),
                            "serviceStart": str(query["startDate"]) + "T12:00:00Z",
                            "serviceEnd": str(query["endDate"]) + "T12:00:00Z",
                            "id": f"a0000000-a000-4000-8000-a0000000000{index}",
                            "bookingStatus": "unbooked",
                            "type": kind,
                            "price": {
                                "currency": "EUR",
                                "finalCustomerMinor": 100000,
                                "taxesMinor": 0,
                                "feesMinor": 0,
                            },
                        },
                        "eligibility": {"status": "eligible"},
                        "occupancy": {"maximumAdults": 10, "maximumChildren": 10},
                    }
                    for index, kind in enumerate(("flight", "accommodation"), 1)
                ]
            }

    async def evaluate():
        for case in cases:
            trip = cast(dict[str, object], case["input"])
            request = CreateAgentRunRequest.model_validate(
                {
                    "contractVersion": "1",
                    "requestId": "a0000000-a000-4000-8000-a00000000001",
                    "conversationId": "a0000000-a000-4000-8000-a00000000002",
                    "purpose": "initial_estimate",
                    "actor": {
                        "userId": "a0000000-a000-4000-8000-a00000000003",
                        "tripId": "a0000000-a000-4000-8000-a00000000004",
                        "baseTripVersion": 1,
                        "scopes": ["trip:read", "proposal:create"],
                    },
                    "message": "Estimate reviewed trip",
                    "context": {
                        "tripSummary": {"version": 1},
                        "contextBudget": {"maximumTokens": 24000},
                    },
                }
            )
            started = perf_counter()
            try:
                result = (await estimate(request, Sources(trip))).root
                success = result.kind == "proposal" and perf_counter() - started <= 30
                outcomes.append(success)
                if result.kind == "proposal":
                    assert [operation.target for operation in result.proposal.operations] == [
                        "/destinations",
                        "/components",
                        "/itineraryDays",
                    ]
                    assert all(
                        operation.target != "/availabilityWindows"
                        for operation in result.proposal.operations
                    )
                    required_accounted.append(
                        any(
                            "No activities before 10:00" in warning
                            for warning in result.proposal.warnings
                        )
                    )
                else:
                    required_accounted.append(False)
            except Exception:
                outcomes.append(False)
                required_accounted.append(False)
            durations.append((perf_counter() - started) * 1000)

    asyncio.run(evaluate())
    assert len(outcomes) == 100
    assert sum(outcomes) >= 95
    assert sum(required_accounted) >= 90
    print(
        f"Graph-only corpus: {sum(outcomes)}/100 proposals within 30s; "
        f"{sum(required_accounted)}/100 requirement disclosures; "
        f"p95={sorted(durations)[94]:.2f}ms. No BFF/database/live-provider latency claim."
    )
