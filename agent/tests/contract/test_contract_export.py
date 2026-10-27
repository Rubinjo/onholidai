import json
import os
import subprocess
import sys
from pathlib import Path
from typing import cast

import pytest
from pydantic import BaseModel, JsonValue, ValidationError

from onholidai_agent.models.api import AgentEvent, CreateAgentRunRequest, PersistAgentResultRequest
from onholidai_agent.models.tools import SUPPLIER_TOOL_INPUTS, ToolCall

ROOT = Path(__file__).resolve().parents[3]
MODELS: dict[str, type[BaseModel]] = {
    "AgentEvent": AgentEvent,
    "CreateAgentRunRequest": CreateAgentRunRequest,
    "PersistAgentResultRequest": PersistAgentResultRequest,
    "ToolCall": ToolCall,
}


@pytest.mark.parametrize("revision", [1, 2])
def test_selected_references_cannot_repeat_an_offer_with_the_same_or_another_revision(
    revision: int,
):
    from tests.integration.test_estimate import request

    raw = request().model_dump(mode="json", by_alias=True)
    raw["purpose"] = "refinement"
    raw["selectedOffers"] = [
        {"offerRef": "10000000-0000-4000-8000-000000000010", "revision": value}
        for value in (1, revision)
    ]
    with pytest.raises(ValidationError):
        CreateAgentRunRequest.model_validate(raw)


def test_shared_supplier_wire_cases_match_pydantic_acceptance() -> None:
    from jsonschema import Draft202012Validator
    from jsonschema.protocols import Validator

    document = json.loads(
        (ROOT / "contracts/supply/validation-cases.json").read_text(encoding="utf-8")
    )
    for case in cast(list[dict[str, object]], document["toolCases"]):
        model = SUPPLIER_TOOL_INPUTS[str(case["tool"])]
        if case["valid"]:
            model.model_validate(case["input"])
        else:
            with pytest.raises(ValidationError):
                model.model_validate(case["input"])
    schema = json.loads(
        (ROOT / "contracts/supply/public-offers-v1.schema.json").read_text(encoding="utf-8")
    )
    validator = cast(Validator, Draft202012Validator(schema))
    for case in cast(list[dict[str, object]], document["offerCases"]):
        assert validator.is_valid(cast(JsonValue, case["value"])) is case["valid"], case["id"]


def test_shared_wire_cases_match_pydantic_acceptance() -> None:
    document = json.loads(
        (ROOT / "contracts/agent-api/validation-cases.json").read_text(encoding="utf-8")
    )
    for case in cast(list[dict[str, object]], document["cases"]):
        model = MODELS[str(case["model"])]
        if case["valid"]:
            model.model_validate(case["value"])
        else:
            with pytest.raises(ValidationError):
                model.model_validate(case["value"])


def test_export_check_detects_reviewed_artifact_edits(tmp_path: Path) -> None:
    command = [
        sys.executable,
        str(ROOT / "agent/scripts/export_contracts.py"),
        "--output-root",
        str(tmp_path),
    ]
    environment = {**os.environ, "PYTHONPATH": str(ROOT / "agent/src")}
    assert (
        subprocess.run(command, env=environment, capture_output=True, check=False).returncode == 0
    )
    assert (
        subprocess.run(
            [*command, "--check"], env=environment, capture_output=True, check=False
        ).returncode
        == 0
    )
    artifact = tmp_path / "contracts/agent-api/openapi.yaml"
    artifact.write_text(artifact.read_text(encoding="utf-8") + "\n", encoding="utf-8")
    result = subprocess.run(
        [*command, "--check"], env=environment, capture_output=True, check=False
    )
    assert result.returncode == 1
    assert b"Agent contract drift" in result.stderr
