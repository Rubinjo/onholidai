import asyncio
from types import SimpleNamespace
from typing import cast

import httpx
import pytest

from onholidai_agent.api.runs import RunService
from onholidai_agent.api.store import RunStore
from onholidai_agent.models.api import (
    AgentEvent,
    AgentPersistenceReceipt,
    AgentRun,
    CreateAgentRunRequest,
)
from tests.contract.test_refinement_tools import refinement_request

RUN_ID = "0f4d1f2e-0f6c-4f0e-9a2b-1c2d3e4f5a6b"


def conflict(code: str) -> httpx.HTTPStatusError:
    request = httpx.Request("PUT", "http://web/api/v1/internal/agent-runs/run/events/1")
    return httpx.HTTPStatusError(
        "rejected",
        request=request,
        response=httpx.Response(409, json={"code": code}, request=request),
    )


class FakeStore:
    """Records cursor writes; each attempt answers with the next scripted problem code."""

    def __init__(self, codes: list[str | None]):
        self.codes = codes
        self.attempts = 0

    async def read(self, request: CreateAgentRunRequest, run_id: str) -> AgentRun:
        return cast(AgentRun, SimpleNamespace(next_event_cursor=0))

    async def event(
        self, request: CreateAgentRunRequest, event: AgentEvent
    ) -> AgentPersistenceReceipt:
        code = self.codes[min(self.attempts, len(self.codes) - 1)]
        self.attempts += 1
        if code is not None:
            raise conflict(code)
        root = event.root
        return AgentPersistenceReceipt.model_validate(
            {
                "runId": root.run_id,
                "requestId": request.request_id,
                "acceptedCursor": root.cursor,
                "resultRecorded": False,
            }
        )


def emit_once(store: FakeStore) -> int:
    async def check() -> int:
        service = RunService(store=cast(RunStore, store))
        return await service.emit(
            refinement_request("Could we spend only 3 nights in Osaka?"),
            RUN_ID,
            {"type": "progress", "stage": "researching", "message": "Searching planning sources"},
        )

    return asyncio.run(check())


def test_a_rejected_proposal_is_never_replayed() -> None:
    store = FakeStore(["incomplete_estimate", None, None])
    with pytest.raises(httpx.HTTPStatusError):
        emit_once(store)
    # A rejection on evidence grounds repeats the same repricing, so it is not retried.
    assert store.attempts == 1


def test_a_lost_cursor_race_is_retried() -> None:
    store = FakeStore(["run_conflict", "run_conflict", None])
    assert emit_once(store) == 1
    assert store.attempts == 3


def test_a_persistent_cursor_race_surfaces_the_rejection() -> None:
    store = FakeStore(["run_conflict", "run_conflict", "run_conflict"])
    with pytest.raises(httpx.HTTPStatusError):
        emit_once(store)
    assert store.attempts == 3
