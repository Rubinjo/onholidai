import pytest

from onholidai_agent.config import Settings
from onholidai_agent.telemetry.langsmith import SafeLangSmithSink


class Sink:
    def __init__(self):
        self.runs: list[dict[str, object]] = []

    def create_run(
        self, name: str, inputs: dict[str, object], run_type: str, **kwargs: object
    ) -> None:
        self.runs.append({"name": name, "inputs": inputs, "run_type": run_type, **kwargs})


def test_export_contains_only_allowlisted_redacted_metadata():
    client = Sink()
    sink = SafeLangSmithSink(
        client,
        Settings(
            _env_file=None,  # pyright: ignore[reportCallIssue]
            langsmith_agent_id="onholidai",
            langsmith_agent_environment="local",
        ),
    )
    sink.emit("refinement", "proposal", 12.5)
    assert len(client.runs) == 1
    run = client.runs[0]
    assert set(run) == {
        "name",
        "inputs",
        "run_type",
        "id",
        "address",
        "start_time",
        "end_time",
        "outputs",
        "extra",
    }
    assert run["name"] == "onholidai.planning"
    assert run["inputs"] == {}
    assert run["outputs"] == {"purpose": "refinement", "outcome": "proposal", "duration_ms": 12.5}
    assert run["extra"] == {"metadata": {"agent_id": "onholidai", "agent_environment": "local"}}


@pytest.mark.parametrize(
    "purpose,outcome,elapsed_ms",
    [
        ("raw traveller prompt", "proposal", 42),
        ("refinement", "supplier margin password", 42),
        ("refinement", "supplier margin", 12.5),
        ("refinement", "proposal", -1),
    ],
)
def test_invalid_metadata_is_rejected_before_ingestion(
    purpose: str, outcome: str, elapsed_ms: float
):
    client = Sink()
    sink = SafeLangSmithSink(client, Settings(_env_file=None))  # pyright: ignore[reportCallIssue]
    sink.emit(purpose, outcome, elapsed_ms)
    assert client.runs == []
