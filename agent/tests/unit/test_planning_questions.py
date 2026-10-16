import asyncio
from copy import deepcopy

from onholidai_agent.graph.refine import dispatch
from onholidai_agent.integrations.nebius import DeterministicModel
from onholidai_agent.models.api import CreateAgentRunRequest
from tests.contract.test_refinement_tools import RefinementSource, refinement_request


class QuestionSource(RefinementSource):
    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]:
        raise AssertionError("An informational question must not request new offers")


def test_question_answers_with_options_without_mutating_the_trip():
    source = QuestionSource()
    before = deepcopy(source.trip)
    result = asyncio.run(
        dispatch(refinement_request("What are my options for this holiday?"), source)
    )
    assert result.root.kind == "answer"
    assert "review" in result.root.message
    assert source.trip == before


def test_deterministic_model_supplies_options_for_the_real_question_prompt():
    result = asyncio.run(
        DeterministicModel().complete(
            messages=[
                {"role": "system", "content": "Answer the traveller's question in plain language."}
            ]
        )
    )
    assert "Two options" in result
    assert "No trip changes" in result
