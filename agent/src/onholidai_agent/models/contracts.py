import json
from pathlib import Path
from typing import cast

from pydantic import BaseModel, JsonValue

from . import api, tools
from .common import PROTECTED_KEYS, DraftOperation

API_MODELS: tuple[type[BaseModel], ...] = (
    api.CreateAgentRunRequest,
    api.AgentRun,
    api.AgentResult,
    api.AgentEvent,
    api.EventBase,
    api.AnswerClarificationRequest,
    api.Problem,
    api.PersistAgentEventRequest,
    api.PersistAgentResultRequest,
    api.AgentPersistenceReceipt,
    DraftOperation,
)


def component_schemas() -> dict[str, JsonValue]:
    schemas: dict[str, JsonValue] = {}
    for model in (*API_MODELS, tools.ToolCall):
        schema = model.model_json_schema(by_alias=True, ref_template="#/components/schemas/{model}")
        definitions = cast(dict[str, JsonValue], schema.pop("$defs", {}))
        for name, definition in {**definitions, model.__name__: cast(JsonValue, schema)}.items():
            if name in schemas and schemas[name] != definition:
                raise ValueError(f"Conflicting model definition: {name}")
            schemas[name] = definition
    return schemas


def response(model: str, description: str) -> dict[str, JsonValue]:
    return {
        "description": description,
        "content": {"application/json": {"schema": {"$ref": f"#/components/schemas/{model}"}}},
    }


def problem_response(description: str) -> dict[str, JsonValue]:
    return {
        "description": description,
        "content": {
            "application/problem+json": {"schema": {"$ref": "#/components/schemas/Problem"}}
        },
    }


def build_openapi() -> dict[str, JsonValue]:
    run_id: JsonValue = {"$ref": "#/components/parameters/RunId"}
    run_response = response("AgentRun", "Durable scoped run status and typed result")
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "OnHolid.ai Internal Agent API",
            "version": "1.0.0",
            "description": (
                "Generated from bounded Pydantic models. Agent runs emit proposals; "
                "they do not mutate trips or execute transactions."
            ),
        },
        "servers": [{"url": "http://agent:8000/internal/v1"}],
        "security": [{"internalService": []}],
        "paths": {
            "/agent-runs": {
                "post": {
                    "operationId": "createAgentRun",
                    "parameters": [
                        {
                            "in": "header",
                            "name": "x-agent-run-id",
                            "required": True,
                            "schema": {"type": "string", "format": "uuid"},
                            "description": (
                                "Identity of the durable web reservation; "
                                "it is never allocated by the agent."
                            ),
                        }
                    ],
                    "summary": "Start an idempotent research run at an exact trip version",
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/CreateAgentRunRequest"}
                            }
                        },
                    },
                    "responses": {
                        "202": run_response,
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "409": problem_response("Request fingerprint or base-version conflict"),
                        "422": {"$ref": "#/components/responses/ValidationError"},
                    },
                }
            },
            "/agent-runs/{runId}": {
                "get": {
                    "operationId": "getAgentRun",
                    "parameters": [run_id],
                    "responses": {
                        "200": run_response,
                        "404": {"$ref": "#/components/responses/NotFound"},
                    },
                }
            },
            "/agent-runs/{runId}/events": {
                "get": {
                    "operationId": "streamAgentRunEvents",
                    "summary": "Replay recorded events without rerunning tools",
                    "parameters": [
                        run_id,
                        {
                            "name": "after",
                            "in": "query",
                            "schema": {"type": "integer", "minimum": 0},
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": (
                                "SSE with monotonic IDs; Last-Event-ID or after resumes replay."
                            ),
                            "content": {
                                "text/event-stream": {
                                    "schema": {"type": "string"},
                                    "x-sse-event-schema": {
                                        "$ref": "#/components/schemas/AgentEvent"
                                    },
                                }
                            },
                        }
                    },
                }
            },
            "/agent-runs/{runId}/clarifications": {
                "post": {
                    "operationId": "answerClarification",
                    "parameters": [run_id],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {
                                    "$ref": "#/components/schemas/AnswerClarificationRequest"
                                }
                            }
                        },
                    },
                    "responses": {
                        "202": run_response,
                        "409": problem_response("Question is stale or already answered"),
                    },
                }
            },
        },
        "components": {
            "securitySchemes": {
                "internalService": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "short-lived scoped service token",
                }
            },
            "parameters": {
                "RunId": {
                    "name": "runId",
                    "in": "path",
                    "required": True,
                    "schema": {"type": "string", "format": "uuid"},
                }
            },
            "responses": {
                "Unauthorized": problem_response("Invalid or insufficient service credential"),
                "NotFound": problem_response("Run not found within the actor scope"),
                "ValidationError": problem_response("Safe contract validation failed"),
            },
            "schemas": component_schemas(),
        },
        "x-protected-draft-keys": cast(JsonValue, PROTECTED_KEYS),
    }


def build_tool_schema() -> dict[str, JsonValue]:
    schema = tools.ToolCall.model_json_schema(by_alias=True)
    return cast(
        dict[str, JsonValue],
        {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": "https://onholid.ai/contracts/agent-tools/v1",
            **schema,
            "type": "object",
            "x-protected-draft-keys": PROTECTED_KEYS,
        },
    )


def exported_files(root: Path) -> dict[Path, str]:
    openapi = json.dumps(build_openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    tools_schema = (
        json.dumps(build_tool_schema(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    )
    supplier_tools = (
        json.dumps(
            {
                "$schema": "https://json-schema.org/draft/2020-12/schema",
                "$id": "https://onholidai.local/contracts/supply/supplier-tools-v1.schema.json",
                "tools": {
                    name: model.model_json_schema(by_alias=True)
                    for name, model in tools.SUPPLIER_TOOL_INPUTS.items()
                },
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    return {
        root / "contracts/agent-api/openapi.yaml": openapi,
        root / "specs/001-ai-trip-agent/contracts/agent-api.openapi.yaml": openapi,
        root / "contracts/agent-api/tools.schema.json": tools_schema,
        root / "specs/001-ai-trip-agent/contracts/agent-tools.schema.json": tools_schema,
        root / "contracts/supply/supplier-tools-v1.schema.json": supplier_tools,
    }
