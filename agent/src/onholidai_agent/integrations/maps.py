from typing import cast

import httpx

from .http import bounded_post
from .research import ReadOnlyResearchClient


class MapsGroundingClient(ReadOnlyResearchClient):
    """Read-only Grounding Lite transport, with bounded unverified attributed facts."""


class MapsHttpTransport:
    def __init__(self, client: httpx.AsyncClient, key: str):
        self.client, self.key = client, key

    async def search(self, query: str, limit: int) -> list[dict[str, object]]:
        # Fixed read-only tool name, never discovered/executed from model or source text.
        data = await bounded_post(
            self.client,
            "https://mapstools.googleapis.com/mcp",
            {"X-Goog-Api-Key": self.key, "Accept": "application/json, text/event-stream"},
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {"name": "search_places", "arguments": {"text_query": query}},
            },
        )
        if "error" in data:
            raise ValueError("maps_research_unavailable")
        result = cast(dict[str, object], data.get("result", {}))
        content = cast(list[dict[str, object]], result.get("content", []))
        return [
            {
                "text": str(item.get("text", ""))[:2000],
                "source_url": "https://mapstools.googleapis.com/mcp",
            }
            for item in content[:limit]
            if item.get("type") == "text"
        ]
