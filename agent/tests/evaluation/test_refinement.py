import asyncio
import json
from copy import deepcopy
from pathlib import Path
from typing import cast

import httpx
import pytest

from onholidai_agent.api.store import WebRunStore
from onholidai_agent.graph.refine import refine
from onholidai_agent.integrations.nebius import DeterministicModel, NebiusClient
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.models.api import CreateAgentRunRequest
from tests.contract.test_refinement_tools import RefinementSource, refinement_request
from tests.integration.test_estimate import Sources


def test_extra_nights_and_required_mornings_produce_reviewable_operations():
    source = RefinementSource()
    before = deepcopy(source.trip)
    result = asyncio.run(
        refine(refinement_request("Add two days in Kyoto and keep mornings free"), source)
    )
    assert result.root.kind == "proposal"
    assert len(result.root.proposal.operations) == 2
    assert result.root.proposal.operations[1].target == "/constraints/-"
    assert result.root.proposal.base_trip_version == 2
    assert result.root.proposal.rationale
    assert source.trip == before


def test_a_balanced_night_shift_keeps_the_demo_trip_length():
    # The demo refinement must move one night without changing the trip length.
    source = RefinementSource()
    before = deepcopy(source.trip)
    result = asyncio.run(
        refine(
            refinement_request(
                "Give Kyoto one more night and Tokyo one less, "
                "keeping the total trip length the same."
            ),
            source,
        )
    )
    assert result.root.kind == "proposal"
    operation = result.root.proposal.operations[0]
    assert operation.target == "/destinations"
    routed = [cast(dict[str, object], entry) for entry in cast(list[object], operation.value)]
    assert [
        (entry["name"], entry["plannedNights"], entry["arrivalDate"], entry["departureDate"])
        for entry in routed
    ] == [
        ("Tokyo", 2, "2030-05-01", "2030-05-03"),
        ("Kyoto", 4, "2030-05-03", "2030-05-07"),
    ]
    assert "Keep the trip at 7 days" in result.root.proposal.rationale
    assert source.trip == before


@pytest.mark.parametrize("budget", [False, True])
def test_selected_supplier_research_uses_proposals_without_model_prices_or_a_forced_choice(
    budget: bool,
):
    corpus = json.loads((Path(__file__).parents[1] / "fixtures/evaluation-corpus.json").read_text())

    class SelectedSource(Sources):
        async def selected_offers(self, request: CreateAgentRunRequest) -> list[dict[str, object]]:
            return deepcopy(corpus["decisions"][0]["offers"][1:])

    source = SelectedSource()
    snapshot = cast(dict[str, object], source.trip["snapshot"])
    snapshot["availabilityWindows"] = [{"startDate": "2030-05-10", "endDate": "2030-05-15"}]
    retained = deepcopy(corpus["decisions"][0]["offers"][0]["component"])
    retained.update(
        id="b0000000-0000-4000-8000-000000000009",
        serviceStart="2030-05-10T08:00:00Z",
        serviceEnd="2030-05-10T10:00:00Z",
    )
    snapshot["components"] = [retained]
    if budget:
        snapshot["constraints"] = [
            {
                "category": "budget",
                "priority": "required",
                "status": "active",
                "statement": "Maximum EUR 150.00 total",
            }
        ]
    before = deepcopy(source.trip)
    raw = refinement_request("Use this sourced option").model_dump(mode="json", by_alias=True)
    raw["actor"]["baseTripVersion"] = 1
    raw["context"]["tripSummary"]["version"] = 1
    raw["selectedOffers"] = [{"offerRef": "b0000000-0000-4000-8000-000000000001", "revision": 1}]
    result = asyncio.run(refine(CreateAgentRunRequest.model_validate(raw), source)).root
    if budget:
        assert result.kind == "clarification"
        assert result.clarification.material_reason == "price"
        assert source.trip == before
        return
    assert result.kind == "proposal"
    assert result.proposal.operations[0].target == "/components"
    assert retained in cast(list[object], result.proposal.operations[0].value)
    assert source.trip == before
    assert "reserved" in " ".join(result.proposal.warnings)


def test_consequential_guidance_points_to_review_without_claiming_booking_is_unavailable():
    result = asyncio.run(refine(refinement_request("book everything"), RefinementSource())).root
    assert result.kind == "answer"
    assert "unavailable in the planning release" not in result.message
    assert "review" in result.message


def test_frozen_refinement_and_ambiguity_corpus():
    corpus = json.loads((Path(__file__).parents[1] / "fixtures/evaluation-corpus.json").read_text())
    failures: list[str] = []
    for case in corpus["unambiguousRequests"]:
        source = RefinementSource()
        source.trip = cast(dict[str, object], case["input"])
        before = deepcopy(source.trip)
        request = refinement_request(case["request"]).model_dump(mode="json", by_alias=True)
        request["requestId"] = case["requestId"]
        result = asyncio.run(refine(CreateAgentRunRequest.model_validate(request), source))
        if (
            result.root.kind != "proposal"
            or [
                operation.model_dump(mode="json", by_alias=True)
                for operation in result.root.proposal.operations
            ]
            != case["expected"]["operations"]
        ):
            failures.append(case["id"])
        assert source.trip == before
    assert len(corpus["unambiguousRequests"]) == 100
    assert not failures, failures
    for case in corpus["ambiguities"]:
        source = RefinementSource()
        source.trip = cast(dict[str, object], case["input"])
        result = asyncio.run(refine(refinement_request(case["request"]), source))
        assert result.root.kind == "clarification", case["id"]
    assert len(corpus["ambiguities"]) == 20


@pytest.mark.parametrize("count", [0, 1, 2], ids=["none", "unique", "ambiguous"])
def test_scoped_retrieval_recovers_a_unique_rejected_destination_or_asks_once(count: int):
    async def exercise():
        fixture = RefinementSource()
        requested: list[str] = []

        def transport(request: httpx.Request) -> httpx.Response:
            requested.append(request.url.path)
            if request.url.path.endswith("agent-view"):
                return httpx.Response(200, json=fixture.trip)
            assert request.url.path == "/api/v1/internal/context/search"
            body = json.loads(request.content)
            assert body["limit"] == 20
            return httpx.Response(
                200,
                json={
                    "items": [
                        {
                            "source": "rejected_proposal",
                            "sourceTripVersion": 1,
                            "authoritative": False,
                            "destinations": [
                                {
                                    "id": f"20000000-0000-4000-8000-{index:012}",
                                    "name": "Osaka",
                                    "plannedNights": 3,
                                    "arrivalDate": "2030-05-01",
                                    "departureDate": "2030-05-04",
                                    "routePosition": 0,
                                }
                            ],
                        }
                        for index in range(count)
                    ]
                },
            )

        async with httpx.AsyncClient(
            base_url="https://synthetic.invalid", transport=httpx.MockTransport(transport)
        ) as client:
            store = WebRunStore(client, "synthetic-local-service-secret-000000000")
            sources = EstimateSources(store, NebiusClient(DeterministicModel(), "synthetic-model"))
            result = await refine(
                refinement_request("Use the place we rejected earlier instead"), sources
            )
            assert requested == [
                "/api/v1/internal/trips/10000000-0000-4000-8000-000000000004/agent-view",
                "/api/v1/internal/context/search",
            ]
            if count == 1:
                assert result.root.kind == "proposal"
                assert result.root.proposal.operations[0].target == "/destinations"
                assert "Osaka" in result.root.proposal.rationale
            else:
                assert result.root.kind == "clarification"
                assert result.root.clarification.question.count("?") == 1

    asyncio.run(exercise())
