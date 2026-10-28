import asyncio
from typing import cast

import pytest

from onholidai_agent.api.store import RunStore
from onholidai_agent.graph.budgets import PLANNING_GRAPH_BUDGET_SECONDS
from onholidai_agent.graph.refine import refine
from onholidai_agent.integrations.nebius import (
    DEFAULT_REQUEST_TIMEOUT_SECONDS,
    NebiusClient,
)
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.models.api import CreateAgentRunRequest
from tests.contract.test_refinement_tools import RefinementSource, refinement_request


class AdviceModel:
    def __init__(self, advice: str, delay_seconds: float = 0):
        self.advice, self.delay_seconds, self.calls = advice, delay_seconds, 0

    async def complete(self, messages: list[dict[str, str]]) -> str:
        self.calls += 1
        if self.delay_seconds:
            await asyncio.sleep(self.delay_seconds)
        return self.advice


def advisory(advice: str, trip_source: RefinementSource | None = None) -> EstimateSources:
    store = trip_source or RefinementSource()
    return EstimateSources(
        store=cast(RunStore, store), model=cast(NebiusClient, AdviceModel(advice))
    )


def test_advice_satisfying_the_operation_contract_becomes_a_proposal():
    result = asyncio.run(
        refine(
            refinement_request("Make the plan sit more lightly on each city"),
            advisory(
                '{"operations": [{"operation": "replace", "target": "/preferences/pace", '
                '"value": 40}], "rationale": "A calmer pace.", "warnings": []}'
            ),
        )
    )
    assert result.root.kind == "proposal"
    assert result.root.proposal.operations[0].target == "/preferences/pace"


@pytest.mark.parametrize(
    "advice",
    [
        # Non-contract keys: an advisory patch must never reach an accepted proposal.
        '{"operations": [{"op": "replace", "path": "/destinations/0/plannedNights", '
        '"value": 4}], "rationale": "x"}',
        # Protected and unknown targets are equally unusable.
        '{"operations": [{"operation": "replace", "target": "/price", "value": 1}], '
        '"rationale": "x"}',
        # An empty or oversized patch cannot be a draft change.
        '{"operations": [], "rationale": "x"}',
        '{"operations": [{"operation": "replace", "target": "/preferences/pace", "value": 1}]}',
    ],
)
def test_unusable_advice_asks_one_question_instead_of_failing_the_run(advice: str):
    result = asyncio.run(
        refine(refinement_request("Make the plan sit more lightly on each city"), advisory(advice))
    )
    assert result.root.kind == "clarification"
    assert result.root.clarification.question.count("?") == 1


def test_advice_question_is_returned_as_the_single_clarification():
    result = asyncio.run(
        refine(
            refinement_request("Make the plan sit more lightly on each city"),
            advisory('{"question": "Which city should carry the extra night?"}'),
        )
    )
    assert result.root.kind == "clarification"
    assert result.root.clarification.question == "Which city should carry the extra night?"


def test_planning_budget_allows_a_live_model_completion_and_web_repricing():
    # A refinement asks the model for operations and web then reprices them with supplier
    # research, so a single model timeout must never be the whole graph's budget.
    assert PLANNING_GRAPH_BUDGET_SECONDS > DEFAULT_REQUEST_TIMEOUT_SECONDS * 2


def test_refinement_graph_is_governed_by_the_shared_budget(monkeypatch: pytest.MonkeyPatch):
    import onholidai_agent.graph.refine as refine_module

    class SlowSource(RefinementSource):
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            await asyncio.sleep(0.2)
            return self.trip

    monkeypatch.setattr(refine_module, "PLANNING_GRAPH_BUDGET_SECONDS", 0.05)
    with pytest.raises(TimeoutError):
        asyncio.run(refine(refinement_request("Add two nights there"), SlowSource()))


def test_refresh_instruction_reestimates_from_sources_without_asking_the_model():
    from tests.integration.test_estimate import QuotedSources
    from tests.integration.test_estimate import request as estimate_request

    sources = QuotedSources()
    raw = estimate_request().model_dump(mode="json", by_alias=True)
    raw["purpose"] = "refinement"
    raw["message"] = (
        "Estimate my reviewed settings and update my draft trip. "
        "Retry supplier research for: activity."
    )
    result = asyncio.run(refine(CreateAgentRunRequest.model_validate(raw), sources))
    assert result.root.kind == "proposal"
    assert result.root.proposal.purpose == "refinement"
    targets = [operation.target for operation in result.root.proposal.operations]
    assert "/components" in targets and "/destinations" in targets


def test_refresh_instruction_without_a_research_reader_asks_rather_than_failing():
    result = asyncio.run(
        refine(
            refinement_request("Estimate my reviewed settings and update my draft trip."),
            RefinementSource(),
        )
    )
    assert result.root.kind == "clarification"
