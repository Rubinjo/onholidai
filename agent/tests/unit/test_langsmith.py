from onholidai_agent.config import Settings
from onholidai_agent.telemetry.langsmith import SafeLangSmithSink


class Sink:
    def __init__(self):
        self.runs: list[dict[str, object]] = []

    def create_run(
        self, name: str, inputs: dict[str, object], run_type: str, **kwargs: object
    ) -> None:
        self.runs.append({"name": name, "inputs": inputs, "run_type": run_type, **kwargs})


def test_export_is_allowlisted_before_ingestion():
    client = Sink()
    sink = SafeLangSmithSink(client, Settings())
    sink.emit("refinement", "proposal", 42)
    sink.emit("raw traveller prompt", "proposal", 42)
    sink.emit("refinement", "supplier margin password", 42)
    assert len(client.runs) == 1
    assert client.runs[0]["inputs"] == {}
    assert client.runs[0]["outputs"] == {
        "purpose": "refinement",
        "outcome": "proposal",
        "duration_ms": 42,
    }
