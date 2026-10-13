from datetime import UTC, datetime
from typing import Protocol, cast
from uuid import uuid4

from langsmith import AgentAddress, Client, RunTree

from onholidai_agent.config import Settings


class TraceClient(Protocol):
    def create_run(
        self, name: str, inputs: dict[str, object], run_type: str, **kwargs: object
    ) -> None: ...


class TraceRun(Protocol):
    def post(self) -> None: ...


class TraceConstructor(Protocol):
    def __call__(self, **kwargs: object) -> TraceRun: ...


class AddressedTraceClient:
    def __init__(self, client: Client):
        self.client = client

    def create_run(
        self, name: str, inputs: dict[str, object], run_type: str, **kwargs: object
    ) -> None:
        constructor = cast(TraceConstructor, RunTree)
        run = constructor(
            name=name, inputs=inputs, run_type=run_type, ls_client=self.client, **kwargs
        )
        run.post()


class SafeLangSmithSink:
    """Export only a fixed operation name and validated aggregate outcome metadata."""

    def __init__(self, client: TraceClient, settings: Settings):
        self.client = client
        self.settings = settings

    def emit(self, purpose: str, outcome: str, elapsed_ms: float) -> None:
        if purpose not in {"initial_estimate", "refinement"}:
            return
        if outcome not in {"proposal", "clarification", "answer", "failed"} or elapsed_ms < 0:
            return
        now = datetime.now(UTC)
        self.client.create_run(
            "onholidai.planning",
            {},
            "chain",
            id=uuid4(),
            address=AgentAddress(
                self.settings.langsmith_agent_id, self.settings.langsmith_agent_environment
            ),
            start_time=now,
            end_time=now,
            outputs={"purpose": purpose, "outcome": outcome, "duration_ms": elapsed_ms},
            extra={
                "metadata": {
                    "agent_id": self.settings.langsmith_agent_id,
                    "agent_environment": self.settings.langsmith_agent_environment,
                }
            },
        )
