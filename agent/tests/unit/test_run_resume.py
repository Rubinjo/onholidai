import asyncio
import hashlib
import json
from typing import cast

from onholidai_agent.api.runs import RunService, without_repeated_question
from onholidai_agent.api.store import RunStore
from onholidai_agent.models.api import (
    AgentEvent,
    AgentPersistenceReceipt,
    AgentResult,
    AgentRun,
    AnswerClarificationRequest,
    CreateAgentRunRequest,
)
from tests.contract.test_refinement_tools import refinement_request

RUN_ID = "0f4d1f2e-0f6c-4f0e-9a2b-1c2d3e4f5a6b"
QUESTION_ID = "1f4d1f2e-0f6c-4f0e-9a2b-1c2d3e4f5a6b"
ORIGINAL = "Add a traditional geisha show dinner to my stay in Tokyo"
QUESTION = (
    "Which sourced Tokyo activity should I add: Tokyo Traditional Geisha Show; "
    "Tokyo Traditional Geisha Dinner?"
)
ANSWER = "Tokyo Traditional Geisha Dinner"


def answer(text: str = ANSWER) -> AnswerClarificationRequest:
    return AnswerClarificationRequest.model_validate(
        {
            "requestId": "2f4d1f2e-0f6c-4f0e-9a2b-1c2d3e4f5a6b",
            "questionId": QUESTION_ID,
            "answer": text,
        }
    )


def fingerprint(value: AnswerClarificationRequest) -> str:
    return hashlib.sha256(
        json.dumps(
            value.model_dump(mode="json", by_alias=True),
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()


def running_run() -> AgentRun:
    return AgentRun.model_validate(
        {
            "id": RUN_ID,
            "requestId": "3f4d1f2e-0f6c-4f0e-9a2b-1c2d3e4f5a6b",
            "tripId": "10000000-0000-4000-8000-000000000004",
            "conversationId": "10000000-0000-4000-8000-000000000002",
            "purpose": "refinement",
            "baseTripVersion": 3,
            "status": "running",
            "result": None,
            "nextEventCursor": 3,
            "leaseExpiresAt": "2030-01-01T00:01:00Z",
            "lastDurableProgressAt": "2030-01-01T00:00:00Z",
            "interruptionReason": None,
            "createdAt": "2030-01-01T00:00:00Z",
            "completedAt": None,
        }
    )


class ResumeStore:
    """The web-side run the traveller answered; callbacks only allocate cursors."""

    def __init__(self, run: AgentRun, receipt: dict[str, object]):
        self.run = run
        self.receipt = receipt
        self.events_after: list[int] = []

    async def read(self, request: CreateAgentRunRequest, run_id: str) -> AgentRun:
        return self.run

    async def resume_receipt(
        self, request: CreateAgentRunRequest, run_id: str, question_id: str
    ) -> dict[str, object]:
        assert question_id == QUESTION_ID
        return self.receipt

    async def events(
        self, request: CreateAgentRunRequest, run_id: str, after: int
    ) -> list[AgentEvent]:
        self.events_after.append(after)
        clarification = AgentEvent.model_validate(
            {
                "version": "1",
                "runId": run_id,
                "cursor": 3,
                "occurredAt": "2030-01-01T00:00:00Z",
                "type": "clarification",
                "clarification": {
                    "id": QUESTION_ID,
                    "question": QUESTION,
                    "materialReason": "scope",
                },
            }
        )
        return [clarification] if after < 3 else []

    async def event(
        self, request: CreateAgentRunRequest, event: AgentEvent
    ) -> AgentPersistenceReceipt:
        root = event.root
        return AgentPersistenceReceipt.model_validate(
            {
                "runId": root.run_id,
                "requestId": request.request_id,
                "acceptedCursor": root.cursor,
                "resultRecorded": False,
            }
        )


class Worked:
    def __init__(self) -> None:
        self.calls: list[tuple[CreateAgentRunRequest, dict[str, object] | None]] = []


def resume(store: ResumeStore, worked: Worked) -> None:
    original_work = RunService.work

    async def record(
        self: RunService,
        request: CreateAgentRunRequest,
        run_id: str,
        receipt: dict[str, object] | None = None,
    ) -> None:
        worked.calls.append((request, receipt))

    RunService.work = record  # pyright: ignore[reportAttributeAccessIssue]
    try:
        service = RunService(store=cast(RunStore, store))
        asyncio.run(service.resume(refinement_request(ORIGINAL), RUN_ID, answer()))
    finally:
        RunService.work = original_work  # pyright: ignore[reportAttributeAccessIssue]


def test_a_resumed_run_keeps_the_answer_apart_from_the_request() -> None:
    worked = Worked()
    resume(
        ResumeStore(running_run(), {"fingerprint": fingerprint(answer()), "eventCursor": 3}), worked
    )
    assert len(worked.calls) == 1
    # The graph reads the experience name from the request and the chosen listing from
    # the answer; joining them without the marker loses the choice.
    assert worked.calls[0][0].message == f"{ORIGINAL}\nClarification: {ANSWER}"


def test_a_resumed_run_hands_the_receipt_to_the_work_without_waiting_for_it() -> None:
    store = ResumeStore(running_run(), {"fingerprint": fingerprint(answer()), "eventCursor": 3})
    worked = Worked()
    resume(store, worked)
    # The pending question must not be fetched on the caller's short request path.
    assert store.events_after == []
    assert worked.calls[0][1] == {"fingerprint": fingerprint(answer()), "eventCursor": 3}


def test_the_answered_question_is_read_from_the_resumed_run() -> None:
    store = ResumeStore(running_run(), {"fingerprint": fingerprint(answer()), "eventCursor": 3})
    service = RunService(store=cast(RunStore, store))
    question = asyncio.run(
        service.pending_question(
            refinement_request(ORIGINAL), RUN_ID, {"fingerprint": "x", "eventCursor": 3}
        )
    )
    assert store.events_after == [2]
    assert question == QUESTION


def test_a_resumed_run_that_is_not_running_starts_no_work() -> None:
    paused = running_run().model_copy(
        update={"status": "awaiting_clarification", "lease_expires_at": None}
    )
    worked = Worked()
    resume(ResumeStore(paused, {"fingerprint": fingerprint(answer()), "eventCursor": 3}), worked)
    assert worked.calls == []


def clarification(question: str) -> AgentResult:
    return AgentResult.model_validate(
        {
            "kind": "clarification",
            "message": "A choice is needed before proposing changes.",
            "clarification": {
                "id": "4f4d1f2e-0f6c-4f0e-9a2b-1c2d3e4f5a6b",
                "question": question,
                "materialReason": "scope",
            },
        }
    )


def test_the_answered_question_is_never_asked_again() -> None:
    result = without_repeated_question(clarification(QUESTION), QUESTION)
    assert result.root.kind == "answer"
    assert QUESTION in result.root.message
    assert "nothing changed" in result.root.message


def test_a_new_question_after_an_answer_is_still_asked() -> None:
    result = without_repeated_question(clarification(QUESTION), "an earlier question?")
    assert result.root.kind == "clarification"


def test_a_run_without_an_answer_keeps_its_question() -> None:
    result = without_repeated_question(clarification(QUESTION), None)
    assert result.root.kind == "clarification"
