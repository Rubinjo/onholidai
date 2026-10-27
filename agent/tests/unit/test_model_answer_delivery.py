import asyncio
from collections.abc import Iterator

import httpx
import pytest

from onholidai_agent.config import Settings
from onholidai_agent.graph.refine import MAXIMUM_ANSWER_CHARACTERS, bounded_answer
from onholidai_agent.integrations.nebius import (
    CONTINUATION_INSTRUCTION,
    DEFAULT_MAXIMUM_OUTPUT_TOKENS,
    MAXIMUM_OUTPUT_TOKENS_CEILING,
    ModelOutputTruncated,
    NebiusClient,
    NebiusHttpTransport,
    final_answer_text,
)

MESSAGES = [{"role": "user", "content": "What cities should I visit?"}]


class ScriptedTransport:
    def __init__(self, results: list[object]):
        self.results: Iterator[object] = iter(results)
        self.calls: list[tuple[list[dict[str, str]], int]] = []

    async def complete(
        self, *, model: str, messages: list[dict[str, str]], maximum_output_tokens: int
    ) -> str:
        self.calls.append((list(messages), maximum_output_tokens))
        result = next(self.results)
        if isinstance(result, Exception):
            raise result
        assert isinstance(result, str)
        return result


def completion(
    *, content: str, finish_reason: str = "stop", reasoning: str | None = None
) -> dict[str, object]:
    message: dict[str, object] = {"role": "assistant", "content": content}
    if reasoning is not None:
        message["reasoning_content"] = reasoning
    return {"choices": [{"message": message, "finish_reason": finish_reason}]}


def transport_answer(payload: dict[str, object]) -> str:
    async def exercise() -> str:
        async with httpx.AsyncClient(
            base_url="https://synthetic.invalid",
            transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload)),
        ) as client:
            return await NebiusHttpTransport(
                client, "https://synthetic.invalid", "synthetic-key"
            ).complete(model="synthetic-model", messages=MESSAGES, maximum_output_tokens=4096)

    return asyncio.run(exercise())


def completes(results: list[object]) -> tuple[str, ScriptedTransport]:
    transport = ScriptedTransport(results)
    answer = asyncio.run(NebiusClient(transport, "synthetic-model").complete(MESSAGES))
    return answer, transport


def test_reasoning_text_is_never_part_of_the_answer():
    assert final_answer_text("Here's a thinking process:\n\n1. **Analyze User Input:**") == ""
    assert final_answer_text("<thinking>weigh Tokyo</thinking>Visit Tokyo.") == "Visit Tokyo."
    assert final_answer_text("Thinking: compare Kyoto") == ""


def test_provider_reasoning_field_is_ignored():
    answer = transport_answer(
        completion(
            content="Visit Tokyo and Kyoto.",
            reasoning="Here's a thinking process: the traveller wants cities.",
        )
    )

    assert answer == "Visit Tokyo and Kyoto."


def test_reasoning_spilling_into_the_answer_field_is_rejected():
    with pytest.raises(ValueError, match="invalid_model_result"):
        transport_answer(
            completion(content="Here's a thinking process:\n\n1. **Analyze User Input:** trip data")
        )


def test_answer_budget_is_substantially_larger_than_a_reasoning_trace():
    answer, transport = completes(["Visit Tokyo."])

    assert answer == "Visit Tokyo."
    assert transport.calls[0][1] == DEFAULT_MAXIMUM_OUTPUT_TOKENS
    assert DEFAULT_MAXIMUM_OUTPUT_TOKENS >= 4096


def test_truncated_answer_is_continued_instead_of_delivered_cut_off():
    answer, transport = completes(
        [ModelOutputTruncated("Start with Tokyo, then "), "finish in Kyoto."]
    )

    assert answer == "Start with Tokyo, then finish in Kyoto."
    continued = transport.calls[1][0]
    assert continued[-1]["content"] == CONTINUATION_INSTRUCTION
    assert continued[-2]["role"] == "assistant"
    assert continued[-2]["content"].strip() == "Start with Tokyo, then"


def test_reasoning_only_truncation_widens_the_budget():
    answer, transport = completes([ModelOutputTruncated(""), "Visit Tokyo and Kyoto."])

    assert answer == "Visit Tokyo and Kyoto."
    assert transport.calls[0][1] == DEFAULT_MAXIMUM_OUTPUT_TOKENS
    assert transport.calls[1][1] == MAXIMUM_OUTPUT_TOKENS_CEILING
    assert transport.calls[1][0] == MESSAGES


def test_budget_widening_stops_at_the_ceiling():
    _, transport = completes([ModelOutputTruncated(""), ModelOutputTruncated(""), "Visit Tokyo."])

    assert [budget for _, budget in transport.calls] == [
        DEFAULT_MAXIMUM_OUTPUT_TOKENS,
        MAXIMUM_OUTPUT_TOKENS_CEILING,
        MAXIMUM_OUTPUT_TOKENS_CEILING,
    ]


def test_exhausted_continuations_fail_rather_than_return_partial_text():
    transport = ScriptedTransport([ModelOutputTruncated("Partial ")] * 3)

    with pytest.raises(ValueError, match="model_output_truncated"):
        asyncio.run(NebiusClient(transport, "synthetic-model").complete(MESSAGES))


def test_reasoning_truncation_never_reaches_the_caller():
    with pytest.raises(ModelOutputTruncated) as truncated:
        transport_answer(
            completion(content="Here's a thinking process: comparing", finish_reason="length")
        )

    assert truncated.value.partial == ""


def test_answer_settings_raise_the_output_budget():
    settings = Settings(provider_mode="deterministic")

    assert settings.nebius_max_output_tokens == DEFAULT_MAXIMUM_OUTPUT_TOKENS
    assert settings.nebius_request_timeout_seconds >= 30


def test_overlong_answer_is_trimmed_on_a_boundary_not_mid_word():
    text = ("A complete sentence. " * 700).strip()
    trimmed = bounded_answer(text)

    assert len(trimmed) <= MAXIMUM_ANSWER_CHARACTERS
    assert trimmed.endswith(".")
    assert bounded_answer("Short answer.") == "Short answer."
