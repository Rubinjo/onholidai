from typing import cast

import httpx

from .http import bounded_post
from .research import ReadOnlyResearchClient


class TavilyClient(ReadOnlyResearchClient):
    """Read-only Tavily transport; never accepts or executes transactional tools."""


class TavilyHttpTransport:
    def __init__(self, client: httpx.AsyncClient, key: str):
        self.client, self.key = client, key

    async def search(self, query: str, limit: int) -> list[dict[str, object]]:
        data = await bounded_post(
            self.client,
            "https://api.tavily.com/search",
            {"Authorization": f"Bearer {self.key}"},
            {
                "query": query,
                "max_results": limit,
                "search_depth": "basic",
                "include_raw_content": False,
                "include_answer": False,
            },
        )
        items = cast(list[dict[str, object]], data.get("results", []))
        if len(items) > limit:
            raise ValueError("unbounded_research_result")
        return [
            {"text": str(item.get("content", ""))[:2000], "source_url": str(item.get("url", ""))}
            for item in items
        ]
