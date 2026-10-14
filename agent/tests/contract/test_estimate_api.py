import asyncio
from typing import cast

import httpx
from fastapi.testclient import TestClient

from onholidai_agent.api.main import create_app
from onholidai_agent.api.security import ServiceTokenContext, create_service_token
from onholidai_agent.api.store import RunStore, WebRunStore
from onholidai_agent.config import Settings
from onholidai_agent.context.build import minimized_model_data
from onholidai_agent.integrations.nebius import DeterministicModel, NebiusClient
from onholidai_agent.integrations.tavily import TavilyClient
from onholidai_agent.models.api import AgentRun, CreateAgentRunRequest
from onholidai_agent.telemetry.estimate import EstimateMeasurement, failure_inclusive_success_rate


def test_injected_clients_bound_data_and_do_not_execute_tools():
    client = NebiusClient(DeterministicModel(), "synthetic-model")
    assert "Synthetic" in asyncio.run(
        client.complete([{"role": "user", "content": "Reviewed trip"}])
    )
    assert not hasattr(WebRunStore, "book")
    assert not hasattr(TavilyClient, "cancel")
    safe = minimized_model_data(
        {
            "supplierTotal": 991199,
            "platformMargin": 883388,
            "travellerParty": {"adults": 2},
            "statement": "passport and bearer credential",
            "request": "book it",
        }
    )
    assert isinstance(safe, dict)
    assert "supplierTotal" not in safe and "platformMargin" not in safe
    assert safe["travellerParty"] == {"adults": 2}
    assert safe["statement"] == "[REDACTED]"


def test_deadline_denominator_includes_failed_estimates():
    samples = [
        EstimateMeasurement("proposed", 1000, 0, 1, 1),
        EstimateMeasurement("failed", 30001, 0, 1, 0),
    ]
    assert failure_inclusive_success_rate(samples) == 0.5
    assert "message" not in samples[0].safe_payload()


def test_api_denies_scope_amplification_and_never_echoes_invalid_input():
    class Store:
        async def validate_dispatch(self, request: CreateAgentRunRequest, run_id: str) -> None:
            return None

        async def read(self, request: CreateAgentRunRequest, run_id: str) -> AgentRun:
            return AgentRun.model_validate(
                {
                    "id": run_id,
                    "requestId": request.request_id,
                    "tripId": request.actor.trip_id,
                    "conversationId": request.conversation_id,
                    "purpose": request.purpose,
                    "baseTripVersion": request.actor.base_trip_version,
                    "status": "failed",
                    "nextEventCursor": 0,
                    "result": None,
                    "leaseExpiresAt": None,
                    "lastDurableProgressAt": None,
                    "interruptionReason": "lease_expired",
                    "createdAt": "2030-01-01T00:00:00Z",
                }
            )

    def factory(_client: httpx.AsyncClient, _settings: Settings) -> RunStore:
        return cast(RunStore, Store())

    ids = [f"10000000-0000-4000-8000-{index:012}" for index in range(1, 6)]
    body: dict[str, object] = {
        "contractVersion": "1",
        "requestId": ids[0],
        "conversationId": ids[1],
        "purpose": "initial_estimate",
        "actor": {
            "userId": ids[2],
            "tripId": ids[3],
            "baseTripVersion": 1,
            "scopes": ["trip:read", "proposal:create"],
        },
        "message": "Synthetic request",
        "context": {"tripSummary": {}, "contextBudget": {"maximumTokens": 16000}},
    }
    context = ServiceTokenContext(ids[2], ids[3], ids[0], 1)
    secret = "synthetic-local-service-secret-000000000"
    # Explicit settings keep the contract test independent of a developer's local .env.
    def configured() -> Settings:
        return Settings(_env_file=None, service_token_secret=secret)  # pyright: ignore[reportCallIssue]

    with TestClient(create_app(configured, factory)) as client:
        response = client.post(
            "/internal/v1/agent-runs", json=body, headers={"x-agent-run-id": ids[4]}
        )
        assert response.status_code == 401
        token = create_service_token(
            secret=secret,
            audience="agent",
            context=context,
            scopes=["trip:read", "proposal:create"],
        )
        response = client.post(
            "/internal/v1/agent-runs",
            json=body,
            headers={"x-agent-run-id": ids[4], "authorization": f"Bearer {token}"},
        )
        assert response.status_code == 202
        assert response.json()["status"] == "failed"  # persisted interrupted work is not restarted
        response = client.post(
            "/internal/v1/agent-runs",
            json={**body, "secret": "private-supplier-991199"},
            headers={"x-agent-run-id": ids[4]},
        )
        assert response.status_code == 422
        assert "private-supplier" not in response.text
