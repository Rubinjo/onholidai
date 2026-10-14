import pytest
from pydantic import ValidationError

from onholidai_agent.models.api import AgentEvent, ChangeProposal


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
