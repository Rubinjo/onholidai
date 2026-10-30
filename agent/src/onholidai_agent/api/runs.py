import asyncio
import hashlib
import json
import logging
import time
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from onholidai_agent.api.security import (
    ServiceTokenContext,
    ServiceTokenError,
    verify_service_token,
)
from onholidai_agent.api.store import (
    PersistenceRejected,
    RunStore,
    WebRunStore,
    response_problem_code,
)
from onholidai_agent.graph.clarify import compose_resumed_message
from onholidai_agent.graph.router import dispatch
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.models.api import (
    AgentEvent,
    AgentResult,
    AgentRun,
    AnswerClarificationRequest,
    ClarificationEvent,
    CreateAgentRunRequest,
    PersistAgentResultRequest,
)
from onholidai_agent.telemetry.langsmith import SafeLangSmithSink

router = APIRouter(prefix="/internal/v1")


def timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def authorize(http: Request, request: CreateAgentRunRequest) -> None:
    authorization = http.headers.get("authorization", "")
    context = ServiceTokenContext(
        request.actor.user_id,
        request.actor.trip_id,
        request.request_id,
        request.actor.base_trip_version,
    )
    try:
        if not authorization.startswith("Bearer "):
            raise ServiceTokenError("Missing token")
        claims = verify_service_token(
            authorization[7:],
            secret=http.app.state.settings.service_token_secret,
            expected_audience="agent",
            expected_context=context,
            required_scopes=(
                ["trip:read"]
                if request.purpose == "supplier_research"
                else ["trip:read", "proposal:create"]
            ),
        )
        if any(scope not in claims.scopes for scope in request.actor.scopes):
            raise ServiceTokenError("Scope amplification")
    except ServiceTokenError as error:
        # Fixed categories only: never log a token, claim value or request body.
        reason = str(error)
        category = (
            "future"
            if reason == "Service token is not yet valid"
            else (
                "expired"
                if reason == "Service token has expired"
                else "scope" if "scope" in reason.casefold() else "invalid"
            )
        )
        logging.getLogger(__name__).warning("Service authorization rejected (%s)", category)
        raise HTTPException(401, detail="invalid_service_token") from None


# Web rejects a proposal whose source evidence does not describe the trip with these
# safe problem codes. Any other rejection is a run/transport conflict, not bad evidence.
EVIDENCE_REJECTION_CODES = frozenset({"offer_unavailable"})


# Web rejects a proposal when its own repricing cannot establish complete current
# inventory for the proposed draft. That is a source outage the traveller can retry,
# not a bad agent result and not an unexpected service failure.
SOURCE_REJECTION_CODES = frozenset({"incomplete_estimate"})
# A rejected callback cursor is the only 409 a retry can resolve; every other 409
# repeats the same rejected work.
CURSOR_CONFLICT_CODE = "run_conflict"


def problem_code(error: BaseException) -> str | None:
    """Return the safe problem code of a refused web callback, never its body."""
    if isinstance(error, PersistenceRejected):
        return error.code
    if isinstance(error, httpx.HTTPStatusError):
        return response_problem_code(error.response)
    return None


def without_repeated_question(result: AgentResult, answered: str | None) -> AgentResult:
    """A resumed run never asks the question it just received an answer for.

    Asking again would leave the traveller with the same choice and no way out, so the
    run reports the blockage as its outcome instead of another clarification.
    """
    if answered is None or result.root.kind != "clarification":
        return result
    if result.root.clarification.question != answered:
        return result
    return AgentResult.model_validate(
        {
            "kind": "answer",
            "message": "I could not resolve this from your answer, so nothing changed. " + answered,
        }
    )


def failure_code(error: BaseException) -> str:
    """Classify a failed run so web can present a truthful cause."""
    if isinstance(error, TimeoutError):
        return "estimate_deadline"
    if isinstance(error, ValueError) and error.args == ("source_unavailable",):
        return "source_unavailable"
    rejected = problem_code(error)
    if rejected is not None:
        if rejected.startswith("estimate_evidence_") or rejected in EVIDENCE_REJECTION_CODES:
            return "invalid_result"
        if rejected in SOURCE_REJECTION_CODES:
            return "source_unavailable"
    return "estimate_unavailable"


def scoped_request(http: Request) -> CreateAgentRunRequest:
    try:
        value = CreateAgentRunRequest.model_validate(
            {
                "contractVersion": "1",
                "requestId": http.headers.get("x-request-id"),
                "conversationId": http.headers.get("x-conversation-id"),
                "purpose": "supplier_research",
                "actor": {
                    "userId": http.headers.get("x-user-id"),
                    "tripId": http.headers.get("x-trip-id"),
                    "baseTripVersion": int(http.headers.get("x-base-trip-version", "0")),
                    "scopes": ["trip:read"],
                },
                "message": "Read persisted estimate status",
                "context": {"tripSummary": {}, "contextBudget": {"maximumTokens": 16000}},
            }
        )
    except (ValueError, TypeError):
        raise HTTPException(422, detail="invalid_actor_context") from None
    authorize(http, value)
    return value


class RunService:
    def __init__(
        self,
        store: RunStore,
        sources: EstimateSources | None = None,
        telemetry: SafeLangSmithSink | None = None,
    ):
        self.store = store
        self.sources = sources or store
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.lock = asyncio.Lock()
        self.emit_lock = asyncio.Lock()
        self.telemetry = telemetry

    async def emit(
        self, request: CreateAgentRunRequest, run_id: str, fields: dict[str, object]
    ) -> int:
        # Progress renewal and the final result run as separate tasks, so cursor
        # allocation must be serialized: two concurrent appends would claim the same
        # cursor and the loser's 409 would fail the whole run.
        async with self.emit_lock:
            for attempt in range(3):
                run = await self.store.read(request, run_id)
                event = AgentEvent.model_validate(
                    {
                        "version": "1",
                        "runId": run_id,
                        "cursor": run.next_event_cursor + 1,
                        "occurredAt": timestamp(),
                        **fields,
                    }
                )
                try:
                    receipt = await self.store.event(request, event)
                except httpx.HTTPStatusError as error:
                    # Only a lost cursor race is worth repeating. A rejection on evidence
                    # grounds would replay the same expensive repricing and fail again.
                    if (
                        error.response.status_code == 409
                        and attempt < 2
                        and response_problem_code(error.response) == CURSOR_CONFLICT_CODE
                    ):
                        await asyncio.sleep(0.05 * (attempt + 1))
                        continue
                    raise
                if (
                    receipt.run_id != run_id
                    or receipt.request_id != request.request_id
                    or receipt.accepted_cursor != event.root.cursor
                ):
                    raise ValueError("invalid_callback_receipt")
                return event.root.cursor
            raise ValueError("invalid_callback_receipt")

    async def start(self, request: CreateAgentRunRequest, run_id: str) -> AgentRun:
        async with self.lock:
            await self.store.validate_dispatch(request, run_id)
            run = await self.store.read(request, run_id)
            if (
                run.request_id != request.request_id
                or run.trip_id != request.actor.trip_id
                or run.conversation_id != request.conversation_id
                or run.base_trip_version != request.actor.base_trip_version
                or run.purpose != request.purpose
            ):
                raise HTTPException(409, detail="run_identity_conflict")
            if run.status == "queued" and run_id not in self.tasks:
                await self.emit(
                    request,
                    run_id,
                    {
                        "type": "progress",
                        "stage": "understanding",
                        "message": "Reviewing your confirmed setup",
                    },
                )
                task = asyncio.create_task(self.work(request, run_id))
                self.tasks[run_id] = task
                task.add_done_callback(lambda _: self.tasks.pop(run_id, None))
            # A restarted process never restarts an already-running request.
            return await self.store.read(request, run_id)

    async def renew(self, request: CreateAgentRunRequest, run_id: str) -> None:
        while True:
            await asyncio.sleep(15)
            await self.emit(
                request,
                run_id,
                {
                    "type": "progress",
                    "stage": "researching",
                    "message": "Read-only research in progress",
                },
            )

    async def work(
        self,
        request: CreateAgentRunRequest,
        run_id: str,
        receipt: dict[str, object] | None = None,
    ) -> None:
        started = time.monotonic()
        outcome = "failed"
        renewal = asyncio.create_task(self.renew(request, run_id))
        try:
            # Reading the answered question happens off the resume request path so the
            # caller's short timeout never waits for another service round trip.
            answered = (
                None if receipt is None else await self.pending_question(request, run_id, receipt)
            )
            await self.emit(
                request,
                run_id,
                {
                    "type": "progress",
                    "stage": "researching",
                    "message": "Searching planning sources",
                },
            )
            result = without_repeated_question(await dispatch(request, self.sources), answered)
            renewal.cancel()
            await asyncio.gather(renewal, return_exceptions=True)
            if result.root.kind == "proposal":
                cursor = await self.emit(
                    request,
                    run_id,
                    {
                        "type": "proposal",
                        "proposal": result.root.proposal.model_dump(mode="json", by_alias=True),
                    },
                )
                status = "proposed"
            elif result.root.kind == "clarification":
                cursor = await self.emit(
                    request,
                    run_id,
                    {
                        "type": "clarification",
                        "clarification": result.root.clarification.model_dump(
                            mode="json", by_alias=True
                        ),
                    },
                )
                status = "awaiting_clarification"
            else:
                cursor = await self.emit(
                    request, run_id, {"type": "completed", "status": "completed"}
                )
                status = "completed"
            body = PersistAgentResultRequest.model_validate(
                {
                    "version": "1",
                    "userId": request.actor.user_id,
                    "tripId": request.actor.trip_id,
                    "requestId": request.request_id,
                    "baseTripVersion": request.actor.base_trip_version,
                    "eventCursor": cursor,
                    "status": status,
                    "result": result.model_dump(mode="json", by_alias=True),
                }
            )
            await self.store.result(request, run_id, body)
            outcome = result.root.kind
        except asyncio.CancelledError:
            raise
        except Exception as error:
            code = failure_code(error)
            rejected = problem_code(error)
            # Container logs only: the public event keeps a fixed category, never this detail.
            # The safe problem code is what identifies a rejected proposal without its body.
            logging.getLogger(__name__).exception(
                "Estimate run failed (%s%s)",
                code,
                f" because web rejected it with {rejected}" if rejected else "",
            )
            # No raw exception, source response or personal prompt escapes into a public event.
            failure_body: PersistAgentResultRequest | None = None
            try:
                renewal.cancel()
                await asyncio.gather(renewal, return_exceptions=True)
                cursor = await self.emit(
                    request,
                    run_id,
                    {"type": "failed", "status": "failed", "safeErrorCode": code},
                )
                failure_body = PersistAgentResultRequest.model_validate(
                    {
                        "version": "1",
                        "userId": request.actor.user_id,
                        "tripId": request.actor.trip_id,
                        "requestId": request.request_id,
                        "baseTripVersion": request.actor.base_trip_version,
                        "eventCursor": cursor,
                        "status": "failed",
                        "result": None,
                    }
                )
                await self.store.result(request, run_id, failure_body)
            except Exception as persistence_error:
                # A durable failed event without its result receipt leaves the run open
                # until the lease expires; log it so the lease monitor's verdict is not
                # the only evidence of what happened.
                logging.getLogger(__name__).error(
                    "Failed run result not persisted (%s, run %s, attempt %s)",
                    type(persistence_error).__name__,
                    run_id,
                    "retry" if failure_body is not None else "none",
                )
                if failure_body is not None:
                    with suppress(Exception):
                        await self.store.result(request, run_id, failure_body)
        finally:
            renewal.cancel()
            await asyncio.gather(renewal, return_exceptions=True)
            if self.telemetry:
                with suppress(Exception):
                    await asyncio.to_thread(
                        self.telemetry.emit,
                        request.purpose,
                        outcome,
                        (time.monotonic() - started) * 1000,
                    )

    async def shutdown(self) -> None:
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def pending_question(
        self, request: CreateAgentRunRequest, run_id: str, receipt: dict[str, object]
    ) -> str | None:
        """The question this resume answers, so the run cannot ask it again."""
        cursor = receipt.get("eventCursor")
        if not isinstance(cursor, int) or cursor < 1:
            return None
        try:
            events = await self.store.events(request, run_id, cursor - 1)
        except Exception:
            # The answer is already recorded, so losing this guard must not lose the run.
            logging.getLogger(__name__).warning("Pending question unavailable for run %s", run_id)
            return None
        for event in events:
            root = event.root
            if root.cursor == cursor and isinstance(root, ClarificationEvent):
                return root.clarification.question
        return None

    async def resume(
        self, request: CreateAgentRunRequest, run_id: str, answer: AnswerClarificationRequest
    ) -> AgentRun:
        async with self.lock:
            run = await self.store.read(request, run_id)
            receipt = await self.store.resume_receipt(request, run_id, answer.question_id)
            hash_value = hashlib.sha256(
                json.dumps(
                    answer.model_dump(mode="json", by_alias=True),
                    sort_keys=True,
                    ensure_ascii=False,
                    separators=(",", ":"),
                ).encode()
            ).hexdigest()
            if receipt.get("fingerprint") != hash_value:
                raise HTTPException(409, detail="clarification_fingerprint_conflict")
            if (
                run.status == "running"
                and run.next_event_cursor == receipt.get("eventCursor")
                and run_id not in self.tasks
            ):
                await self.emit(
                    request,
                    run_id,
                    {
                        "type": "progress",
                        "stage": "understanding",
                        "message": "Reviewing your clarification",
                    },
                )
                if isinstance(self.store, WebRunStore):
                    request = await self.store.dispatched_request(request, run_id)
                updated = request.model_copy(
                    update={
                        "message": (
                            answer.answer
                            if request.purpose in ("initial_estimate", "supplier_research")
                            else compose_resumed_message(request.message, answer.answer)
                        )
                    }
                )
                task = asyncio.create_task(self.work(updated, run_id, receipt))
                self.tasks[run_id] = task
                task.add_done_callback(lambda _: self.tasks.pop(run_id, None))
            return await self.store.read(request, run_id)


@router.post("/agent-runs", response_model=AgentRun, status_code=202)
async def create_run(
    http: Request,
    body: CreateAgentRunRequest,
    run_id: Annotated[str, Header(alias="x-agent-run-id")],
) -> AgentRun:
    authorize(http, body)
    return await http.app.state.runs.start(body, run_id)


@router.get("/agent-runs/{run_id}", response_model=AgentRun)
async def get_run(http: Request, run_id: str) -> AgentRun:
    return await http.app.state.runs.store.read(scoped_request(http), run_id)


@router.post("/agent-runs/{run_id}/clarifications", response_model=AgentRun, status_code=202)
async def resume_run(http: Request, run_id: str, body: AnswerClarificationRequest) -> AgentRun:
    return await http.app.state.runs.resume(scoped_request(http), run_id, body)


@router.get("/agent-runs/{run_id}/events")
async def get_events(http: Request, run_id: str, after: int = 0) -> StreamingResponse:
    request = scoped_request(http)
    try:
        cursor = int(http.headers.get("last-event-id", str(after)))
        if cursor < 0:
            raise ValueError()
    except ValueError:
        raise HTTPException(422, detail="invalid_cursor") from None
    events = await http.app.state.runs.store.events(request, run_id, cursor)

    async def stream():
        for event in events:
            data = json.dumps(event.model_dump(mode="json", by_alias=True))
            yield f"id: {event.root.cursor}\nevent: {event.root.type}\ndata: {data}\n\n"

    return StreamingResponse(
        stream(), media_type="text/event-stream", headers={"Cache-Control": "no-store"}
    )
