import asyncio
from copy import deepcopy
from typing import cast

import httpx
import pytest

from onholidai_agent.api.store import WebRunStore
from onholidai_agent.config import Settings
from onholidai_agent.context.build import READ_ONLY_TOOLS, STABLE_INSTRUCTIONS, build_context
from onholidai_agent.context.compact import compact_context
from onholidai_agent.graph.refine import refine
from onholidai_agent.integrations.nebius import DeterministicModel, NebiusClient
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.models.api import (
    AgentResult,
    ContextMessage,
    ConversationSummary,
    CreateAgentRunRequest,
)
from onholidai_agent.telemetry.langsmith import SafeLangSmithSink
from onholidai_agent.tools.retrieve_relevant_context import retrieve_relevant_context
from tests.contract.test_refinement_tools import RefinementSource, refinement_request

STABLE_PREFIX = STABLE_INSTRUCTIONS + " Tools: " + ", ".join(READ_ONLY_TOOLS)


def trip(version: int, name: str = "Tokyo") -> dict[str, object]:
    return {
        "version": version,
        "snapshot": {
            "destinations": [
                {
                    "id": "30000000-0000-4000-8000-000000000001",
                    "name": name,
                    "plannedNights": 3,
                    "arrivalDate": "2030-05-01",
                    "departureDate": "2030-05-04",
                    "routePosition": 0,
                }
            ],
            "duration": {"minimumDays": 5, "idealDays": 7, "maximumDays": 12},
            "constraints": [],
            "preferences": {"pace": 50},
        },
    }


def request(
    base_trip_version: int,
    messages: list[dict[str, object]] | None = None,
    maximum_tokens: int = 24000,
    scopes: list[str] | None = None,
) -> CreateAgentRunRequest:
    return CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": "40000000-0000-4000-8000-000000000001",
            "conversationId": "40000000-0000-4000-8000-000000000002",
            "purpose": "refinement",
            "message": "Synthetic request",
            "actor": {
                "userId": "40000000-0000-4000-8000-000000000003",
                "tripId": "40000000-0000-4000-8000-000000000004",
                "baseTripVersion": base_trip_version,
                "scopes": scopes or ["trip:read", "proposal:create"],
            },
            "context": {
                "tripSummary": {"version": base_trip_version},
                "recentMessages": messages or [],
                "contextBudget": {"maximumTokens": maximum_tokens},
            },
        }
    )


def messages(count: int, size: int) -> list[ContextMessage]:
    return [
        ContextMessage.model_validate(
            {
                "id": f"50000000-0000-4000-8000-{index:012}",
                "role": "user",
                "redactedContent": "x" * size,
                "occurredAt": "2030-01-01T00:00:00Z",
            }
        )
        for index in range(1, count + 1)
    ]


def test_stable_system_and_tool_prefix_is_byte_identical_across_trip_versions():
    unchanged = build_context(request(1), trip(1))
    changed = build_context(request(2), trip(2, "Kyoto"))
    assert unchanged[0] == {"role": "system", "content": STABLE_PREFIX}
    assert changed[0] == unchanged[0]
    assert changed[0]["content"].encode("utf-8") == unchanged[0]["content"].encode("utf-8")
    # The dynamic section is genuinely version-bound, so the equality is not vacuous.
    assert changed[1]["content"] != unchanged[1]["content"]


def test_context_compacts_at_the_documented_threshold_and_stays_within_budget():
    summary = ConversationSummary.model_validate({"sourceTripVersion": 1})
    _, _, below = compact_context(summary, messages(6, 100), 1000)
    _, _, at_threshold = compact_context(summary, messages(7, 100), 1000)
    _, _, too_many = compact_context(summary, messages(100, 1), 1_000_000)
    assert below is False
    assert at_threshold is True
    assert too_many is True
    dynamic = build_context(request(1, [], 24000), trip(1))[1]["content"]
    assert len(dynamic.encode("utf-8")) <= min(32768, 24000 * 2)
    with pytest.raises(ValueError, match="context_budget_exceeded"):
        build_context(request(1, [], 1000), trip(1, "N" * 4000))


class Reader:
    def __init__(self, response: dict[str, object]) -> None:
        self.response = response

    async def retrieve_context(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]:
        return self.response


def test_retrieval_enforces_scope_limit_and_preserves_provenance():
    scoped = request(1, scopes=["trip:read", "context:read", "proposal:create"])
    items: dict[str, object] = {
        "items": [
            {
                "source": "rejected_proposal",
                "sourceTripVersion": 1,
                "authoritative": False,
                "destinations": [{"id": "30000000-0000-4000-8000-000000000009", "name": "Osaka"}],
            }
        ]
    }
    with pytest.raises(ValueError, match="missing_context_scope"):
        asyncio.run(
            retrieve_relevant_context(
                Reader(items), request(1), {"query": "rejected", "reason": "Recall", "limit": 20}
            )
        )
    result = asyncio.run(
        retrieve_relevant_context(
            Reader(items), scoped, {"query": "rejected", "reason": "Recall", "limit": 20}
        )
    )
    assert result == items
    entry = cast(dict[str, object], cast(list[object], result["items"])[0])
    assert entry["source"] == "rejected_proposal"
    assert entry["sourceTripVersion"] == 1
    assert entry["authoritative"] is False
    with pytest.raises(ValueError, match="context_response_exceeded"):
        asyncio.run(
            retrieve_relevant_context(
                Reader({"items": [{}] * 21}),
                scoped,
                {"query": "rejected", "reason": "Recall", "limit": 20},
            )
        )


def test_retrieved_history_cannot_override_authoritative_current_trip():
    current = RefinementSource()
    # A stale historical candidate must never carry authoritative dates or nights.
    historical = {
        "id": "30000000-0000-4000-8000-000000000009",
        "name": "Osaka",
        "plannedNights": 99,
        "arrivalDate": "2099-01-01",
        "departureDate": "2099-01-05",
        "routePosition": 0,
    }

    def transport(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("agent-view"):
            return httpx.Response(200, json=current.trip)
        assert request.url.path == "/api/v1/internal/context/search"
        return httpx.Response(
            200,
            json={
                "items": [
                    {
                        "source": "rejected_proposal",
                        "sourceTripVersion": 1,
                        "authoritative": False,
                        "destinations": [historical],
                    }
                ]
            },
        )

    async def exercise() -> AgentResult:
        async with httpx.AsyncClient(
            base_url="https://synthetic.invalid", transport=httpx.MockTransport(transport)
        ) as client:
            source = EstimateSources(
                WebRunStore(client, "synthetic-local-service-secret-000000000"),
                NebiusClient(DeterministicModel(), "synthetic-model"),
            )
            return await refine(
                refinement_request("Use the place we rejected earlier instead"), source
            )

    before = deepcopy(current.trip)
    result = asyncio.run(exercise())
    assert current.trip == before
    assert result.root.kind == "proposal"
    merged = cast(list[dict[str, object]], result.root.proposal.operations[0].value)
    restored = merged[-1]
    assert restored["name"] == "Osaka"
    assert restored["plannedNights"] == 0
    assert restored["arrivalDate"] is None and restored["departureDate"] is None


def test_measured_120_turn_context_bytes_and_token_estimate(capsys: pytest.CaptureFixture[str]):
    summary = ConversationSummary.model_validate(
        {
            "sourceTripVersion": 2,
            "rejectedOptions": ["Kyoto: previously rejected for cost"],
            "decisions": ["Keep vegetarian meals"],
            "openQuestions": ["Which city?"],
        }
    )
    conversation = messages(120, 400)
    raw_bytes = sum(len(message.redacted_content.encode("utf-8")) for message in conversation)
    retained, recent, compacted = compact_context(summary, conversation, 24000)
    retained_bytes = sum(len(message.redacted_content.encode("utf-8")) for message in recent)
    full = build_context(
        request(1, [message.model_dump(by_alias=True) for message in recent], 24000), trip(1)
    )
    prefix_bytes = len(full[0]["content"].encode("utf-8"))
    dynamic_bytes = len(full[1]["content"].encode("utf-8"))
    estimated_tokens = (dynamic_bytes + prefix_bytes + 3) // 4
    assert compacted
    assert retained == summary
    assert retained.rejected_options == ["Kyoto: previously rejected for cost"]
    assert len(recent) <= 20
    assert retained_bytes <= 8000
    assert dynamic_bytes <= min(32768, 24000 * 2)
    # The compaction threshold treats UTF-8 bytes as a conservative token bound.
    assert dynamic_bytes + prefix_bytes <= 24000
    assert estimated_tokens <= 24000
    with capsys.disabled():
        print(
            f"120-turn measurement: raw={raw_bytes}B retained={retained_bytes}B "
            f"messages={len(recent)} compacted={compacted} prompt={prefix_bytes + dynamic_bytes}B "
            f"prefix={prefix_bytes}B token_estimate~{estimated_tokens}"
        )


class TraceClient:
    def __init__(self) -> None:
        self.runs: list[dict[str, object]] = []

    def create_run(
        self, name: str, inputs: dict[str, object], run_type: str, **kwargs: object
    ) -> None:
        self.runs.append({"name": name, "inputs": inputs, "run_type": run_type, **kwargs})


def test_langsmith_receives_only_allowlisted_redacted_metadata():
    client = TraceClient()
    sink = SafeLangSmithSink(
        client,
        Settings(
            langsmith_agent_id="onholidai",
            langsmith_agent_environment="local",
            service_token_secret="synthetic-local-service-secret-000000000",
        ),
    )
    sink.emit("refinement", "proposal", 12.5)
    sink.emit("raw traveller prompt", "proposal", 12.5)
    sink.emit("refinement", "supplier margin", 12.5)
    assert len(client.runs) == 1
    run = client.runs[0]
    assert set(run) == {
        "name",
        "inputs",
        "run_type",
        "id",
        "address",
        "start_time",
        "end_time",
        "outputs",
        "extra",
    }
    assert run["name"] == "onholidai.planning"
    assert run["inputs"] == {}
    assert run["outputs"] == {"purpose": "refinement", "outcome": "proposal", "duration_ms": 12.5}
    assert run["extra"] == {"metadata": {"agent_id": "onholidai", "agent_environment": "local"}}
