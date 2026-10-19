import asyncio
import hashlib
import json
import logging
import time
from contextlib import suppress
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse

from onholidai_agent.api.security import (
    ServiceTokenContext,
    ServiceTokenError,
    verify_service_token,
)
from onholidai_agent.api.store import RunStore, WebRunStore
from onholidai_agent.graph.router import dispatch
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.models.api import (
    AgentEvent,
    AgentRun,
    AnswerClarificationRequest,
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
                ["trip:read"] if request.purpose == "supplier_research"
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
            else "expired"
            if reason == "Service token has expired"
            else "scope"
            if "scope" in reason.casefold()
            else "invalid"
        )
        logging.getLogger(__name__).warning("Service authorization rejected (%s)", category)
        raise HTTPException(401, detail="invalid_service_token") from None


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
        self.telemetry = telemetry

    async def emit(
        self, request: CreateAgentRunRequest, run_id: str, fields: dict[str, object]
    ) -> int:
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
        receipt = await self.store.event(request, event)
        if (
            receipt.run_id != run_id
            or receipt.request_id != request.request_id
            or receipt.accepted_cursor != event.root.cursor
        ):
            raise ValueError("invalid_callback_receipt")
        return event.root.cursor

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

    async def work(self, request: CreateAgentRunRequest, run_id: str) -> None:
        started = time.monotonic()
        outcome = "failed"
        renewal = asyncio.create_task(self.renew(request, run_id))
        try:
            await self.emit(
                request,
                run_id,
                {
                    "type": "progress",
                    "stage": "researching",
                    "message": "Searching planning sources",
                },
            )
            result = await dispatch(request, self.sources)
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
            # No raw exception, source response or personal prompt escapes into a public event.
            try:
                renewal.cancel()
                await asyncio.gather(renewal, return_exceptions=True)
                cursor = await self.emit(
                    request,
                    run_id,
                    {
                        "type": "failed",
                        "status": "failed",
                        "safeErrorCode": "estimate_deadline"
                        if isinstance(error, TimeoutError)
                        else "source_unavailable"
                        if isinstance(error, ValueError) and error.args == ("source_unavailable",)
                        else "estimate_unavailable",
                    },
                )
                await self.store.result(
                    request,
                    run_id,
                    PersistAgentResultRequest.model_validate(
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
                    ),
                )
            except Exception:
                # An uncertain receipt becomes interrupted when the durable lease expires.
                pass
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
                        "message": answer.answer
                        if request.purpose in ("initial_estimate", "supplier_research")
                        else request.message + "\nClarification: " + answer.answer
                    }
                )
                task = asyncio.create_task(self.work(updated, run_id))
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
