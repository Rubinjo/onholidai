import json
from pathlib import Path
from typing import cast

import pytest
from pydantic import ValidationError

from onholidai_agent.models.api import (
    AgentEvent,
    ChangeProposal,
    CreateAgentRunRequest,
    PersistAgentEventRequest,
    PersistAgentResultRequest,
    TerminalEvent,
)
from onholidai_agent.models.contracts import exported_files
from onholidai_agent.models.tools import RetrieveRelevantContextCall, ToolCall

ROOT = Path(__file__).resolve().parents[3]
USER = "10000000-0000-4000-8000-000000000001"
TRIP = "10000000-0000-4000-8000-000000000002"
REQUEST = "10000000-0000-4000-8000-000000000003"
RUN = "10000000-0000-4000-8000-000000000004"
CONVERSATION = "10000000-0000-4000-8000-000000000005"
COMPONENT = "10000000-0000-4000-8000-000000000006"
TIME = "2030-01-01T00:00:00Z"
TOOL_CONTEXT = {
    "userId": USER,
    "tripId": TRIP,
    "requestId": REQUEST,
    "baseTripVersion": 1,
}


def proposal() -> dict[str, object]:
    return {
        "id": RUN,
        "purpose": "initial_estimate",
        "initiatingRequestId": REQUEST,
        "baseTripVersion": 1,
        "operations": [{"operation": "replace", "target": "/preferences/pace", "value": 60}],
        "affectedFacts": ["pace"],
        "rationale": "A relaxed pace",
        "tradeoffs": [],
        "warnings": [],
        "expiresAt": "2030-01-01T00:10:00Z",
    }


def commands() -> list[dict[str, object]]:
    """Closed command schemas carrying every legitimate optional field."""
    return [
        {
            "version": "1",
            "tool": "get_trip",
            "context": TOOL_CONTEXT,
            "input": {"detail": "pricing", "componentIds": [COMPONENT]},
        },
        {
            "version": "1",
            "tool": "propose_trip_changes",
            "context": TOOL_CONTEXT,
            "input": {
                "purpose": "initial_estimate",
                "initiatingRequestId": REQUEST,
                "operations": [
                    {"operation": "replace", "target": "/preferences/pace", "value": 60}
                ],
                "rationale": "A relaxed pace",
                "affectedFacts": ["pace"],
                "ambiguities": ["Which season?"],
            },
        },
        {
            "version": "1",
            "tool": "retrieve_relevant_context",
            "context": TOOL_CONTEXT,
            "input": {
                "query": "Earlier decision",
                "reason": "Recall a rejected choice",
                "limit": 20,
                "entityIds": [COMPONENT],
                "before": TIME,
            },
        },
    ]


def events() -> list[dict[str, object]]:
    """Closed event variants including an optional terminal code."""
    common = {"version": "1", "runId": RUN, "cursor": 1, "occurredAt": TIME}
    return [
        {**common, "type": "progress", "stage": "researching", "message": "Synthetic progress"},
        {**common, "type": "proposal", "proposal": proposal()},
        {
            **common,
            "type": "clarification",
            "clarification": {"id": RUN, "question": "Which city?", "materialReason": "scope"},
        },
        {**common, "type": "completed", "status": "completed"},
        {**common, "type": "failed", "status": "failed", "safeErrorCode": "source_unavailable"},
    ]


def test_current_event_contract_rejects_unknown_versions_types_and_fields():
    progress = {
        "version": "1",
        "runId": "10000000-0000-4000-8000-000000000001",
        "cursor": 1,
        "occurredAt": "2030-01-01T00:00:00Z",
        "type": "progress",
        "stage": "researching",
        "message": "Synthetic progress",
    }
    assert AgentEvent.model_validate(progress).root.type == "progress"
    for invalid in (
        {**progress, "version": "2"},
        {**progress, "type": "future_event"},
        {**progress, "unexpected": True},
    ):
        with pytest.raises(ValidationError):
            AgentEvent.model_validate(invalid)


def test_command_and_event_composition_accepts_optional_fields_and_rejects_extras():
    for command in commands():
        ToolCall.model_validate(command)
    for event in events():
        AgentEvent.model_validate(event)
    # A closed object never coerces: any undeclared field fails safely.
    for command in commands():
        input_value = cast(dict[str, object], command["input"])
        with pytest.raises(ValidationError):
            ToolCall.model_validate({**command, "input": {**input_value, "extra": True}})
        with pytest.raises(ValidationError):
            ToolCall.model_validate({**command, "version": "2"})
    with pytest.raises(ValidationError):
        ToolCall.model_validate({**commands()[0], "tool": "book_trip"})
    for event in events():
        with pytest.raises(ValidationError):
            AgentEvent.model_validate({**event, "unexpected": True})


def test_proposal_and_callback_composition_binds_request_and_version():
    callback = {
        "version": "1",
        "requestId": REQUEST,
        "userId": USER,
        "tripId": TRIP,
        "baseTripVersion": 1,
        "eventCursor": 1,
        "status": "proposed",
        "result": {"kind": "proposal", "message": "Review this estimate", "proposal": proposal()},
    }
    PersistAgentResultRequest.model_validate(callback)
    event_callback = {
        "version": "1",
        "requestId": REQUEST,
        "userId": USER,
        "tripId": TRIP,
        "baseTripVersion": 1,
        "event": {
            "version": "1",
            "runId": RUN,
            "cursor": 1,
            "occurredAt": TIME,
            "type": "proposal",
            "proposal": proposal(),
        },
    }
    PersistAgentEventRequest.model_validate(event_callback)
    # An execution basis (request identity / base version) cannot be migrated implicitly.
    for mutation in ({"requestId": RUN}, {"baseTripVersion": 2}):
        with pytest.raises(ValidationError):
            PersistAgentResultRequest.model_validate({**callback, **mutation})
        with pytest.raises(ValidationError):
            PersistAgentEventRequest.model_validate({**event_callback, **mutation})


def test_historical_payload_without_optional_fields_remains_readable():
    legacy_request = CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": REQUEST,
            "conversationId": CONVERSATION,
            "purpose": "initial_estimate",
            "message": "Plan a synthetic trip",
            "actor": {
                "userId": USER,
                "tripId": TRIP,
                "baseTripVersion": 1,
                "scopes": ["trip:read", "proposal:create"],
            },
            "context": {"tripSummary": {"version": 1}, "contextBudget": {"maximumTokens": 12000}},
        }
    )
    assert legacy_request.context.conversation_summary is None
    assert legacy_request.context.recent_messages == []
    legacy_event = AgentEvent.model_validate(
        {
            "version": "1",
            "runId": RUN,
            "cursor": 1,
            "occurredAt": TIME,
            "type": "completed",
            "status": "completed",
        }
    )
    assert cast(TerminalEvent, legacy_event.root).safe_error_code is None
    legacy_call = cast(
        RetrieveRelevantContextCall,
        ToolCall.model_validate(
            {
                "version": "1",
                "tool": "retrieve_relevant_context",
                "context": TOOL_CONTEXT,
                "input": {"query": "Earlier decision", "reason": "Recall", "limit": 5},
            }
        ).root,
    )
    assert legacy_call.input.entity_ids == []


def test_initial_estimate_proposal_identity_remains_explicit_and_versioned():
    proposal = ChangeProposal.model_validate(
        {
            "id": "10000000-0000-4000-8000-000000000002",
            "initiatingRequestId": "10000000-0000-4000-8000-000000000003",
            "baseTripVersion": 1,
            "purpose": "initial_estimate",
            "operations": [{"operation": "replace", "target": "/preferences/pace", "value": 55}],
            "rationale": "Synthetic compatibility proposal",
            "affectedFacts": ["Estimated route"],
            "warnings": [],
            "tradeoffs": [],
            "expiresAt": "2030-01-01T01:00:00Z",
        }
    )
    assert proposal.purpose == "initial_estimate"
    assert proposal.base_trip_version == 1


def test_generated_contracts_match_the_exporter_without_drift():
    for path, expected in exported_files(ROOT).items():
        assert path.exists(), f"Missing contract artifact: {path}"
        assert path.read_text(encoding="utf-8") == expected, f"Contract drift: {path.name}"
    openapi = json.loads((ROOT / "contracts/agent-api/openapi.yaml").read_text(encoding="utf-8"))
    assert openapi["openapi"] == "3.1.0"
    assert openapi["info"]["version"] == "1.0.0"
    schemas = openapi["components"]["schemas"]
    for name in ("CreateAgentRunRequest", "AgentEvent", "AgentRun", "ChangeProposal", "ToolCall"):
        assert name in schemas
    tools = json.loads(
        (ROOT / "contracts/agent-api/tools.schema.json").read_text(encoding="utf-8")
    )
    assert tools["$id"] == "https://onholid.ai/contracts/agent-tools/v1"


def test_exported_contract_json_is_stable_across_repeated_generation():
    first = {str(path): content for path, content in exported_files(ROOT).items()}
    second = {str(path): content for path, content in exported_files(ROOT).items()}
    assert first == second
