from typing import Protocol

from onholidai_agent.models.api import CreateAgentRunRequest
from onholidai_agent.models.tools import RetrieveRelevantContextInput


class ContextReader(Protocol):
    async def retrieve_context(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]: ...


async def retrieve_relevant_context(
    reader: ContextReader, request: CreateAgentRunRequest, raw: dict[str, object]
) -> dict[str, object]:
    if "context:read" not in request.actor.scopes:
        raise ValueError("missing_context_scope")
    query = RetrieveRelevantContextInput.model_validate(raw)
    response = await reader.retrieve_context(request, query.model_dump(mode="json", by_alias=True))
    items = response.get("items", [])
    if not isinstance(items, list) or len(items) > query.limit:
        raise ValueError("context_response_exceeded")
    if len(str(response).encode()) > 16000:
        raise ValueError("context_response_exceeded")
    return response
