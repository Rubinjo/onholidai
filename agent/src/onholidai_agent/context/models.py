from pydantic import Field

from onholidai_agent.models.api import ConversationSummary
from onholidai_agent.models.common import ContractModel, PositiveInt, UUIDString


class SummaryProvenance(ContractModel):
    summary_version: PositiveInt
    first_message_id: UUIDString
    last_message_id: UUIDString
    source_trip_version: PositiveInt
    token_estimate: int = Field(ge=0)


__all__ = ["ConversationSummary", "SummaryProvenance"]
