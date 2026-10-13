from copy import deepcopy

import pytest
from pydantic import ValidationError

from onholidai_agent.models.api import (
    AgentEvent,
    AgentRun,
    CreateAgentRunRequest,
    PersistAgentResultRequest,
)
from onholidai_agent.models.tools import ToolCall

USER = "10000000-0000-4000-8000-000000000001"
TRIP = "10000000-0000-4000-8000-000000000002"
REQUEST = "10000000-0000-4000-8000-000000000003"
RUN = "10000000-0000-4000-8000-000000000004"
CONVERSATION = "10000000-0000-4000-8000-000000000005"
TIME = "2030-01-01T00:00:00Z"


def request() -> dict[str, object]:
    return {
        "contractVersion": "1",
        "requestId": REQUEST,
        "conversationId": CONVERSATION,
        "purpose": "initial_estimate",
        "message": "Plan a synthetic trip",
        "actor": {
            "userId": USER,
            "tripId": TRIP,
            "baseTripVersion": 3,
            "scopes": ["trip:read", "proposal:create"],
        },
        "context": {
            "tripSummary": {"version": 3},
            "recentMessages": [],
            "contextBudget": {"maximumTokens": 12000, "compactionThresholdPercent": 70},
        },
    }


def proposal() -> dict[str, object]:
    return {
        "id": RUN,
        "purpose": "initial_estimate",
        "initiatingRequestId": REQUEST,
        "baseTripVersion": 3,
        "operations": [{"operation": "replace", "target": "/preferences/pace", "value": 60}],
        "affectedFacts": ["pace"],
        "rationale": "A relaxed pace",
        "tradeoffs": [],
        "warnings": [],
        "expiresAt": "2030-01-01T00:10:00Z",
    }


def result_callback() -> dict[str, object]:
    return {
        "version": "1",
        "requestId": REQUEST,
        "userId": USER,
        "tripId": TRIP,
        "baseTripVersion": 3,
        "eventCursor": 1,
        "status": "proposed",
        "result": {"kind": "proposal", "message": "Review this estimate", "proposal": proposal()},
    }


def test_first_run_has_a_version_bound_empty_summary() -> None:
    model = CreateAgentRunRequest.model_validate(request())
    summary = model.context.resolved_summary(model.actor.base_trip_version)
    assert summary.source_trip_version == 3
    assert summary.decisions == []
    assert summary.rejected_options == []
    assert model.model_dump(mode="json", by_alias=True)["requestId"] == REQUEST


def test_historical_summary_retains_provenance_without_overriding_current_trip() -> None:
    context = {
        "tripSummary": {"version": 3},
        "conversationSummary": {"sourceTripVersion": 2},
        "contextBudget": {"maximumTokens": 12000},
    }
    model = CreateAgentRunRequest.model_validate({**request(), "context": context})
    assert model.context.resolved_summary(3).source_trip_version == 2
    with pytest.raises(ValidationError):
        CreateAgentRunRequest.model_validate(
            {
                **request(),
                "context": {
                    **context,
                    "conversationSummary": {"sourceTripVersion": 4},
                },
            }
        )


def test_message_limit_counts_unicode_characters() -> None:
    CreateAgentRunRequest.model_validate({**request(), "message": "🙂" * 12000})
    with pytest.raises(ValidationError):
        CreateAgentRunRequest.model_validate({**request(), "message": "🙂" * 12001})


@pytest.mark.parametrize("key", ["supplier_amount", "SupplierAmount", "platform_margin"])
def test_sensitive_json_keys_cannot_evade_the_boundary_by_changing_spelling(key: str) -> None:
    context = {"tripSummary": {"nested": {key: 991234}}, "contextBudget": {"maximumTokens": 12000}}
    with pytest.raises(ValidationError):
        CreateAgentRunRequest.model_validate({**request(), "context": context})


@pytest.mark.parametrize(
    "mutation",
    [
        {"contractVersion": "2"},
        {"purpose": "book_trip"},
        {"message": "x" * 12001},
        {"bookingAuthorization": "forbidden"},
    ],
)
def test_unknown_versions_transactional_fields_and_oversize_messages_fail(
    mutation: dict[str, object],
) -> None:
    with pytest.raises(ValidationError):
        CreateAgentRunRequest.model_validate({**request(), **mutation})


def test_context_requires_scopes_and_bounds_recent_history_and_budget() -> None:
    model = request()
    actor = {"userId": USER, "tripId": TRIP, "baseTripVersion": 3, "scopes": ["trip:read"]}
    with pytest.raises(ValidationError):
        CreateAgentRunRequest.model_validate({**model, "actor": actor})
    message = {"id": RUN, "role": "user", "redactedContent": "Synthetic", "occurredAt": TIME}
    for context in [
        {
            "tripSummary": {},
            "recentMessages": [message] * 21,
            "contextBudget": {"maximumTokens": 12000, "compactionThresholdPercent": 70},
        },
        {
            "tripSummary": {},
            "contextBudget": {"maximumTokens": 12000, "compactionThresholdPercent": 71},
        },
        {"tripSummary": {"supplierAmount": 991234}, "contextBudget": {"maximumTokens": 12000}},
    ]:
        with pytest.raises(ValidationError):
            CreateAgentRunRequest.model_validate({**model, "context": context})


def test_flattened_closed_events_accept_legitimate_variant_fields() -> None:
    common = {"version": "1", "runId": RUN, "cursor": 1, "occurredAt": TIME}
    events = [
        {**common, "type": "progress", "stage": "researching", "message": "Searching"},
        {**common, "type": "proposal", "proposal": proposal()},
        {
            **common,
            "type": "clarification",
            "clarification": {"id": RUN, "question": "Which city?", "materialReason": "scope"},
        },
        {**common, "type": "completed", "status": "completed"},
        {**common, "type": "failed", "status": "failed", "safeErrorCode": "source_unavailable"},
    ]
    for event in events:
        assert AgentEvent.model_validate(event).model_dump(mode="json", by_alias=True) is not None
    for invalid in [
        {**events[0], "unknown": True},
        {**common, "type": "booking"},
        {**common, "type": "failed", "status": "completed"},
        {**events[0], "occurredAt": "2030-01-01T00:00:00"},
    ]:
        with pytest.raises(ValidationError):
            AgentEvent.model_validate(invalid)


def test_result_receipts_bind_proposal_request_version_and_status() -> None:
    PersistAgentResultRequest.model_validate(result_callback())
    for mutation in [
        {"requestId": RUN},
        {"baseTripVersion": 4},
        {"eventCursor": 0},
        {"status": "completed"},
        {"status": "failed"},
    ]:
        with pytest.raises(ValidationError):
            PersistAgentResultRequest.model_validate({**result_callback(), **mutation})
    assert (
        PersistAgentResultRequest.model_validate(
            {**result_callback(), "status": "failed", "result": None}
        ).result
        is None
    )


def test_run_lease_and_result_state_are_consistent() -> None:
    run = {
        "id": RUN,
        "requestId": REQUEST,
        "conversationId": CONVERSATION,
        "tripId": TRIP,
        "purpose": "initial_estimate",
        "baseTripVersion": 3,
        "status": "running",
        "nextEventCursor": 0,
        "leaseExpiresAt": "2030-01-01T00:01:30Z",
        "lastDurableProgressAt": TIME,
        "interruptionReason": None,
        "createdAt": TIME,
    }
    AgentRun.model_validate(run)
    with pytest.raises(ValidationError):
        AgentRun.model_validate({**run, "leaseExpiresAt": None})
    with pytest.raises(ValidationError):
        AgentRun.model_validate({**run, "status": "awaiting_clarification"})
    with pytest.raises(ValidationError):
        AgentRun.model_validate(
            {
                **run,
                "status": "completed",
                "leaseExpiresAt": None,
                "result": {"kind": "answer", "message": "Unreviewable estimate"},
            }
        )


def test_tools_are_bounded_and_draft_only_with_exact_request_identity() -> None:
    context = {"userId": USER, "tripId": TRIP, "requestId": REQUEST, "baseTripVersion": 3}
    call = {
        "version": "1",
        "tool": "propose_trip_changes",
        "context": context,
        "input": {
            key: value
            for key, value in proposal().items()
            if key in ("purpose", "initiatingRequestId", "operations", "rationale", "affectedFacts")
        },
    }
    ToolCall.model_validate(call)
    for target in ["/bookings", "/price", "/components/0/bookingStatus", "/preferences/__proto__"]:
        invalid = deepcopy(call)
        invalid["input"] = {
            "purpose": "refinement",
            "initiatingRequestId": REQUEST,
            "operations": [{"operation": "replace", "target": target, "value": None}],
            "rationale": "Invalid",
            "affectedFacts": ["pace"],
        }
        with pytest.raises(ValidationError):
            ToolCall.model_validate(invalid)
    for tool in ["book_trip", "cancel_component", "reschedule_component", "update_trip"]:
        with pytest.raises(ValidationError):
            ToolCall.model_validate({**call, "tool": tool})
    for limit in [0, 21]:
        with pytest.raises(ValidationError):
            ToolCall.model_validate(
                {
                    "version": "1",
                    "tool": "retrieve_relevant_context",
                    "context": context,
                    "input": {"query": "Earlier decision", "reason": "Recall", "limit": limit},
                }
            )
