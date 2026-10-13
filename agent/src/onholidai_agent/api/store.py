import asyncio
from typing import Protocol

import httpx

from onholidai_agent.api.security import ServiceTokenContext, create_service_token
from onholidai_agent.models.api import (
    AgentEvent,
    AgentPersistenceReceipt,
    AgentRun,
    CreateAgentRunRequest,
    PersistAgentEventRequest,
    PersistAgentResultRequest,
)


class RunStore(Protocol):
    async def validate_dispatch(self, request: CreateAgentRunRequest, run_id: str) -> None: ...
    async def resume_receipt(
        self, request: CreateAgentRunRequest, run_id: str, question_id: str
    ) -> dict[str, object]: ...
    async def read(self, request: CreateAgentRunRequest, run_id: str) -> AgentRun: ...
    async def events(
        self, request: CreateAgentRunRequest, run_id: str, after: int
    ) -> list[AgentEvent]: ...
    async def event(
        self, request: CreateAgentRunRequest, event: AgentEvent
    ) -> AgentPersistenceReceipt: ...
    async def result(
        self, request: CreateAgentRunRequest, run_id: str, result: PersistAgentResultRequest
    ) -> AgentPersistenceReceipt: ...
    async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]: ...
    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]: ...


class WebRunStore:
    def __init__(self, client: httpx.AsyncClient, secret: str):
        self.client = client
        self.secret = secret

    def headers(self, request: CreateAgentRunRequest, scope: str) -> dict[str, str]:
        context = ServiceTokenContext(
            request.actor.user_id,
            request.actor.trip_id,
            request.request_id,
            request.actor.base_trip_version,
        )
        token = create_service_token(
            secret=self.secret, audience="web", context=context, scopes=[scope]
        )
        return {
            "authorization": f"Bearer {token}",
            "x-user-id": context.user_id,
            "x-request-id": context.request_id,
            "x-trip-id": context.trip_id,
            "x-base-trip-version": str(context.base_trip_version),
        }

    async def dispatched_request(
        self, request: CreateAgentRunRequest, run_id: str
    ) -> CreateAgentRunRequest:
        response = await self.client.get(
            f"/api/v1/internal/agent-runs/{run_id}/dispatch",
            headers=self.headers(request, "run:write"),
        )
        response.raise_for_status()
        return CreateAgentRunRequest.model_validate(response.json())

    async def retrieve_context(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]:
        response = await self.client.post(
            "/api/v1/internal/context/search",
            json=query,
            headers=self.headers(request, "context:read"),
        )
        response.raise_for_status()
        return dict(response.json())

    async def validate_dispatch(self, request: CreateAgentRunRequest, run_id: str) -> None:
        response = await self.client.post(
            f"/api/v1/internal/agent-runs/{run_id}/validate",
            json=request.model_dump(mode="json", by_alias=True),
            headers=self.headers(request, "run:write"),
        )
        if response.status_code == 409:
            from fastapi import HTTPException

            raise HTTPException(409, detail="request_fingerprint_conflict")
        response.raise_for_status()

    async def read(self, request: CreateAgentRunRequest, run_id: str) -> AgentRun:
        response = await self.client.get(
            f"/api/v1/internal/agent-runs/{run_id}", headers=self.headers(request, "run:write")
        )
        response.raise_for_status()
        return AgentRun.model_validate(response.json())

    async def resume_receipt(
        self, request: CreateAgentRunRequest, run_id: str, question_id: str
    ) -> dict[str, object]:
        response = await self.client.get(
            f"/api/v1/internal/agent-runs/{run_id}/resumes/{question_id}",
            headers=self.headers(request, "run:write"),
        )
        response.raise_for_status()
        return dict(response.json())

    async def events(
        self, request: CreateAgentRunRequest, run_id: str, after: int
    ) -> list[AgentEvent]:
        response = await self.client.get(
            f"/api/v1/internal/agent-runs/{run_id}/events",
            params={"after": after},
            headers=self.headers(request, "run:write"),
        )
        response.raise_for_status()
        return [AgentEvent.model_validate(event) for event in response.json()]

    async def persist(
        self, request: CreateAgentRunRequest, path: str, body: dict[str, object]
    ) -> AgentPersistenceReceipt:
        # PUT retries reuse the same body/identity; an uncertain receipt never reruns research.
        for attempt in range(3):
            try:
                response = await self.client.put(
                    path, json=body, headers=self.headers(request, "run:write")
                )
                response.raise_for_status()
                return AgentPersistenceReceipt.model_validate(response.json())
            except (httpx.TimeoutException, httpx.NetworkError):
                if attempt == 2:
                    raise
                await asyncio.sleep(0.05 * (attempt + 1))
        raise RuntimeError("unreachable")

    async def event(
        self, request: CreateAgentRunRequest, event: AgentEvent
    ) -> AgentPersistenceReceipt:
        body = PersistAgentEventRequest.model_validate(
            {
                "version": "1",
                "requestId": request.request_id,
                "userId": request.actor.user_id,
                "tripId": request.actor.trip_id,
                "baseTripVersion": request.actor.base_trip_version,
                "event": event.model_dump(mode="json", by_alias=True),
            }
        )
        return await self.persist(
            request,
            f"/api/v1/internal/agent-runs/{event.root.run_id}/events/{event.root.cursor}",
            body.model_dump(mode="json", by_alias=True),
        )

    async def result(
        self, request: CreateAgentRunRequest, run_id: str, result: PersistAgentResultRequest
    ) -> AgentPersistenceReceipt:
        return await self.persist(
            request,
            f"/api/v1/internal/agent-runs/{run_id}/result",
            result.model_dump(mode="json", by_alias=True),
        )

    async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
        response = await self.client.get(
            f"/api/v1/internal/trips/{request.actor.trip_id}/agent-view",
            params={"baseTripVersion": request.actor.base_trip_version, "detail": "compact"},
            headers=self.headers(request, "trip:read"),
        )
        response.raise_for_status()
        return dict(response.json())

    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]:
        response = await self.client.post(
            f"/api/v1/internal/trips/{request.actor.trip_id}/planning-search",
            json=query,
            headers=self.headers(request, "trip:read"),
        )
        response.raise_for_status()
        return dict(response.json())
