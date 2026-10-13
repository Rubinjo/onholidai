from typing import Annotated, Literal

from pydantic import ConfigDict, Field, RootModel

from .api import ProposalPurpose
from .common import (
    ContractModel,
    DraftOperation,
    PositiveInt,
    Text200,
    Text500,
    Text1000,
    Text4000,
    UTCDateTime,
    UUIDString,
)


class Context(ContractModel):
    user_id: UUIDString
    trip_id: UUIDString
    request_id: UUIDString
    base_trip_version: PositiveInt


class GetTripInput(ContractModel):
    detail: Literal["compact", "itinerary", "components", "pricing", "constraints"]
    component_ids: list[UUIDString] = Field(
        default_factory=list, max_length=32, json_schema_extra={"default": []}
    )


class ProposeTripChangesInput(ContractModel):
    purpose: ProposalPurpose
    initiating_request_id: UUIDString
    operations: list[DraftOperation] = Field(min_length=1, max_length=32)
    rationale: Text4000
    affected_facts: list[Text200] = Field(min_length=1, max_length=64)
    ambiguities: list[Text1000] = Field(
        default_factory=list, max_length=20, json_schema_extra={"default": []}
    )


class RetrieveRelevantContextInput(ContractModel):
    query: Text500
    reason: Text500
    limit: Annotated[int, Field(strict=True, ge=1, le=20)]
    entity_ids: list[UUIDString] = Field(
        default_factory=list, max_length=32, json_schema_extra={"default": []}
    )
    before: UTCDateTime | None = None


class GetTripCall(ContractModel):
    version: Literal["1"]
    tool: Literal["get_trip"]
    context: Context
    input: GetTripInput


class ProposeTripChangesCall(ContractModel):
    model_config = ConfigDict(
        json_schema_extra={"x-equal-fields": [["input.initiatingRequestId", "context.requestId"]]}
    )
    version: Literal["1"]
    tool: Literal["propose_trip_changes"]
    context: Context
    input: ProposeTripChangesInput


class RetrieveRelevantContextCall(ContractModel):
    version: Literal["1"]
    tool: Literal["retrieve_relevant_context"]
    context: Context
    input: RetrieveRelevantContextInput


class ToolCall(
    RootModel[
        Annotated[
            GetTripCall | ProposeTripChangesCall | RetrieveRelevantContextCall,
            Field(discriminator="tool"),
        ]
    ]
):
    model_config = ConfigDict(hide_input_in_errors=True)
