from typing import Annotated, Literal, cast

from pydantic import ConfigDict, Field, JsonValue, RootModel

from .common import (
    ContractModel,
    DraftOperation,
    NonNegativeInt,
    PositiveInt,
    Text120,
    Text200,
    Text500,
    Text1000,
    Text4000,
    Text12000,
    UTCDateTime,
    UUIDString,
    status_result_rules,
)

type ProposalPurpose = Literal["initial_estimate", "refinement", "finalization"]
type RunPurpose = Literal["initial_estimate", "refinement", "finalization", "supplier_research"]
type AgentScope = Literal["trip:read", "context:read", "proposal:create"]


class ActorContext(ContractModel):
    model_config = ConfigDict(
        json_schema_extra={
            "allOf": [
                {"properties": {"scopes": {"contains": {"const": "trip:read"}}}},
                {"properties": {"scopes": {"uniqueItems": True}}},
            ]
        }
    )
    user_id: UUIDString
    trip_id: UUIDString
    base_trip_version: PositiveInt
    scopes: list[AgentScope] = Field(min_length=1, max_length=3)


class ContextBudget(ContractModel):
    maximum_tokens: Annotated[int, Field(strict=True, ge=1000, le=2147483647)]
    compaction_threshold_percent: Literal[70] = 70


class ConversationSummary(ContractModel):
    constraints: list[Text1000] = Field(
        default_factory=list, max_length=64, json_schema_extra={"default": []}
    )
    preferences: list[Text1000] = Field(
        default_factory=list, max_length=64, json_schema_extra={"default": []}
    )
    decisions: list[Text1000] = Field(
        default_factory=list, max_length=64, json_schema_extra={"default": []}
    )
    rejected_options: list[Text1000] = Field(
        default_factory=list, max_length=64, json_schema_extra={"default": []}
    )
    open_questions: list[Text1000] = Field(
        default_factory=list, max_length=20, json_schema_extra={"default": []}
    )
    source_trip_version: PositiveInt


class ContextMessage(ContractModel):
    id: UUIDString
    role: Literal["user", "assistant", "system"]
    redacted_content: Text12000
    occurred_at: UTCDateTime


class PromptContext(ContractModel):
    trip_summary: dict[str, JsonValue] = Field(
        max_length=64,
        json_schema_extra={
            "x-json-bound": {"bytes": 32768, "depth": 16, "allowBookingStatus": True}
        },
    )
    conversation_summary: ConversationSummary | None = None
    recent_messages: list[ContextMessage] = Field(
        default_factory=lambda: list[ContextMessage](),
        max_length=20,
        json_schema_extra={"default": []},
    )
    context_budget: ContextBudget

    def resolved_summary(self, base_trip_version: int) -> ConversationSummary:
        return self.conversation_summary or ConversationSummary.model_validate(
            {"sourceTripVersion": base_trip_version}
        )


class CreateAgentRunRequest(ContractModel):
    model_config = ConfigDict(
        json_schema_extra={
            "allOf": [
                {
                    "if": {
                        "properties": {
                            "purpose": {
                                "enum": [
                                    "initial_estimate",
                                    "refinement",
                                    "finalization",
                                ]
                            }
                        }
                    },
                    "then": {
                        "properties": {
                            "actor": {
                                "properties": {
                                    "scopes": {"contains": {"const": "proposal:create"}},
                                }
                            }
                        }
                    },
                },
            ],
            "x-equal-fields": [
                ["context.tripSummary.version", "actor.baseTripVersion"],
            ],
            "x-not-future-fields": [
                ["context.conversationSummary.sourceTripVersion", "actor.baseTripVersion"]
            ],
        }
    )
    contract_version: Literal["1"]
    actor: ActorContext
    request_id: UUIDString
    conversation_id: UUIDString
    message: Text12000
    context: PromptContext
    purpose: RunPurpose


class Clarification(ContractModel):
    id: UUIDString
    question: Text1000
    material_reason: Literal[
        "scope", "price", "accessibility", "feasibility", "experience", "transaction"
    ]


class ChangeProposal(ContractModel):
    id: UUIDString
    purpose: ProposalPurpose
    initiating_request_id: UUIDString
    base_trip_version: PositiveInt
    operations: list[DraftOperation] = Field(min_length=1, max_length=32)
    affected_facts: list[Text200] = Field(min_length=1, max_length=64)
    rationale: Text4000
    tradeoffs: list[Text1000] = Field(max_length=32)
    warnings: list[Text1000] = Field(max_length=64)
    expires_at: UTCDateTime


class AnswerResult(ContractModel):
    kind: Literal["answer"]
    message: Text12000


class ClarificationResult(ContractModel):
    kind: Literal["clarification"]
    message: Text12000
    clarification: Clarification


class ProposalResult(ContractModel):
    kind: Literal["proposal"]
    message: Text12000
    proposal: ChangeProposal


class AgentResult(
    RootModel[
        Annotated[AnswerResult | ClarificationResult | ProposalResult, Field(discriminator="kind")]
    ]
):
    model_config = ConfigDict(hide_input_in_errors=True)


class EventFields(ContractModel):
    version: Literal["1"]
    run_id: UUIDString
    cursor: PositiveInt
    occurred_at: UTCDateTime


class EventBase(EventFields):
    type: Text120


class ProgressEvent(EventFields):
    type: Literal["progress"]
    stage: Literal["understanding", "researching", "evaluating", "composing"]
    message: Text1000


class ClarificationEvent(EventFields):
    type: Literal["clarification"]
    clarification: Clarification


class ProposalEvent(EventFields):
    type: Literal["proposal"]
    proposal: ChangeProposal


class TerminalEvent(EventFields):
    model_config = ConfigDict(json_schema_extra={"x-equal-fields": [["type", "status"]]})
    type: Literal["completed", "failed"]
    status: Literal["completed", "failed"]
    safe_error_code: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,119}$")] | None = None


class AgentEvent(
    RootModel[
        Annotated[
            ProgressEvent | ClarificationEvent | ProposalEvent | TerminalEvent,
            Field(discriminator="type"),
        ]
    ]
):
    model_config = ConfigDict(hide_input_in_errors=True)


class AgentRun(ContractModel):
    model_config = ConfigDict(
        json_schema_extra={
            "allOf": [
                *status_result_rules(),
                {
                    "if": {"properties": {"purpose": {"const": "supplier_research"}}},
                    "then": {
                        "properties": {
                            "status": {
                                "enum": [
                                    "queued",
                                    "running",
                                    "awaiting_clarification",
                                    "completed",
                                    "failed",
                                    "cancelled",
                                ]
                            },
                            "result": {
                                "properties": {
                                    "kind": {"enum": ["answer", "clarification"]},
                                }
                            },
                        },
                    },
                },
                {
                    "if": {"properties": {"purpose": {"const": "initial_estimate"}}},
                    "then": {
                        "properties": {
                            "status": {
                                "enum": [
                                    "queued",
                                    "running",
                                    "awaiting_clarification",
                                    "proposed",
                                    "failed",
                                    "cancelled",
                                ]
                            }
                        }
                    },
                },
                {
                    "if": {"properties": {"status": {"enum": ["queued", "running"]}}},
                    "then": {"properties": {"leaseExpiresAt": {"type": "string"}}},
                },
                {
                    "if": {"properties": {"status": {"const": "awaiting_clarification"}}},
                    "then": {"properties": {"leaseExpiresAt": {"type": "null"}}},
                },
            ],
            "x-equal-fields": [
                ["result.proposal.initiatingRequestId", "requestId"],
                ["result.proposal.baseTripVersion", "baseTripVersion"],
                ["result.proposal.purpose", "purpose"],
            ],
        }
    )
    id: UUIDString
    request_id: UUIDString
    trip_id: UUIDString
    conversation_id: UUIDString
    purpose: RunPurpose
    base_trip_version: PositiveInt
    status: Literal[
        "queued",
        "running",
        "awaiting_clarification",
        "proposed",
        "completed",
        "failed",
        "cancelled",
    ]
    result: AgentResult | None = None
    next_event_cursor: NonNegativeInt
    lease_expires_at: UTCDateTime | None
    last_durable_progress_at: UTCDateTime | None
    interruption_reason: Literal["lease_expired"] | None
    created_at: UTCDateTime
    completed_at: UTCDateTime | None = None


class AnswerClarificationRequest(ContractModel):
    request_id: UUIDString
    question_id: UUIDString
    answer: Text4000


class PersistAgentEventRequest(ContractModel):
    model_config = ConfigDict(
        json_schema_extra={
            "x-equal-fields": [
                ["event.proposal.initiatingRequestId", "requestId"],
                ["event.proposal.baseTripVersion", "baseTripVersion"],
            ]
        }
    )
    version: Literal["1"]
    request_id: UUIDString
    user_id: UUIDString
    trip_id: UUIDString
    base_trip_version: PositiveInt
    event: AgentEvent


class PersistAgentResultRequest(ContractModel):
    model_config = ConfigDict(
        json_schema_extra=cast(
            dict[str, JsonValue],
            {
                "allOf": status_result_rules(),
                "x-equal-fields": [
                    ["result.proposal.initiatingRequestId", "requestId"],
                    ["result.proposal.baseTripVersion", "baseTripVersion"],
                ],
            },
        )
    )
    version: Literal["1"]
    request_id: UUIDString
    user_id: UUIDString
    trip_id: UUIDString
    base_trip_version: PositiveInt
    event_cursor: PositiveInt
    status: Literal["awaiting_clarification", "proposed", "completed", "failed"]
    result: AgentResult | None


class AgentPersistenceReceipt(ContractModel):
    run_id: UUIDString
    request_id: UUIDString
    accepted_cursor: PositiveInt
    result_recorded: bool = Field(strict=True)


class Problem(ContractModel):
    type: Text500
    title: Text200
    status: Annotated[int, Field(strict=True, ge=400, le=599)]
    code: Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,119}$")]
    correlation_id: Annotated[
        str, Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_.:-]+$")
    ]
    detail: Text1000 | None = None
