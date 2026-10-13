import asyncio
from typing import Protocol

from onholidai_agent.models.api import CreateAgentRunRequest


class ResearchReader(Protocol):
    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]: ...


async def research(
    reader: ResearchReader, request: CreateAgentRunRequest, query: dict[str, object]
) -> dict[str, object]:
    async with asyncio.timeout(8):
        result = await reader.search(request, query)
    return result
