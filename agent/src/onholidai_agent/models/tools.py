from datetime import date
from typing import Annotated, Literal, Self

from pydantic import ConfigDict, Field, RootModel, model_validator

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


type SupplierComponentType = Literal["flight", "accommodation", "activity", "rail"]
type SupplierOfferReference = Annotated[str, Field(strict=True, min_length=1, max_length=256)]


class SupplierSearchInput(ContractModel):
    model_config = ConfigDict(strict=True)
    component_types: list[SupplierComponentType] = Field(min_length=1, max_length=4)
    destination_ids: list[UUIDString] = Field(min_length=1, max_length=8)
    start_date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    end_date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
    # A named-product search within the trip's scope; suppliers that publish a text
    # catalogue use it instead of returning their generic destination ranking.
    query: Text200 | None = None
    departure_place_id: SupplierOfferReference | None = None
    requirement_ids: list[SupplierOfferReference] = Field(default_factory=list, max_length=32)
    property_types: list[Annotated[str, Field(min_length=1, max_length=200)]] = Field(
        default_factory=list, max_length=16
    )

    @model_validator(mode="after")
    def validate_search_scope(self) -> Self:
        start = date.fromisoformat(self.start_date)
        end = date.fromisoformat(self.end_date)
        if end < start:
            raise ValueError("Supplier search dates must be ordered")
        for values in (
            self.component_types,
            self.destination_ids,
            self.requirement_ids,
            self.property_types,
        ):
            if len(set(values)) != len(values):
                raise ValueError("Supplier search selections must be unique")
        return self


class SupplierOfferInput(ContractModel):
    model_config = ConfigDict(strict=True)
    offer_ref: SupplierOfferReference
    revision: Annotated[int, Field(strict=True, ge=1, le=9007199254740991)]


class SupplierCapabilitiesInput(ContractModel):
    model_config = ConfigDict(strict=True)
    component_types: list[SupplierComponentType] | None = Field(
        default=None, min_length=1, max_length=4
    )

    @model_validator(mode="after")
    def validate_unique_types(self) -> Self:
        if self.component_types is not None and len(set(self.component_types)) != len(
            self.component_types
        ):
            raise ValueError("Supplier component types must be unique")
        return self


SUPPLIER_TOOL_INPUTS: dict[str, type[ContractModel]] = {
    "supplier_search": SupplierSearchInput,
    "supplier_offer_details": SupplierOfferInput,
    "supplier_revalidate_offer": SupplierOfferInput,
    "supplier_capabilities": SupplierCapabilitiesInput,
}
