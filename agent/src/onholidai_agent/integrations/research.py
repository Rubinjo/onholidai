import asyncio
import re
from datetime import UTC, datetime
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field


class ResearchFact(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, hide_input_in_errors=True)
    text: str = Field(min_length=1, max_length=2000)
    source_url: str = Field(min_length=1, max_length=2000)
    fetched_at: str
    verified: bool = False


class SearchTransport(Protocol):
    async def search(self, query: str, limit: int) -> list[dict[str, object]]: ...


class ReadOnlyResearchClient:
    def __init__(self, transport: SearchTransport):
        self.transport = transport

    async def search(self, query: str, limit: int = 5) -> list[ResearchFact]:
        if not query.strip() or len(query) > 500 or not 1 <= limit <= 20:
            raise ValueError("invalid_research_query")
        # Searches contain geography/timing questions, not traveller identifiers or credentials.
        if re.search(r"passport|bearer|password|api.?key|\S+@\S+|(?:\d[ -]?){13,19}", query, re.I):
            raise ValueError("sensitive_research_input")
        async with asyncio.timeout(8):
            raw = await self.transport.search(query, limit)
        if len(raw) > limit:
            raise ValueError("unbounded_research_response")
        timestamp = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        facts = [
            ResearchFact.model_validate({**entry, "fetched_at": timestamp, "verified": False})
            for entry in raw
        ]
        if any(not fact.source_url.startswith("https://") for fact in facts):
            raise ValueError("invalid_source_attribution")
        return facts
