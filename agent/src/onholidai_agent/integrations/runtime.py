import asyncio
from typing import cast

from onholidai_agent.api.store import RunStore
from onholidai_agent.models.api import CreateAgentRunRequest

from .maps import MapsGroundingClient
from .nebius import NebiusClient
from .tavily import TavilyClient


class EstimateSources:
    def __init__(
        self,
        store: RunStore,
        model: NebiusClient,
        maps: MapsGroundingClient | None = None,
        tavily: TavilyClient | None = None,
    ):
        self.store, self.model, self.maps, self.tavily = store, model, maps, tavily

    async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
        return await self.store.get_trip(request)

    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]:
        # Offers go through web; research facts never become prices or verified terms.
        trip = await self.get_trip(request)
        snapshot = cast(dict[str, object], trip["snapshot"])
        places = cast(list[dict[str, object]], snapshot["destinations"])
        geography_query = "Travel overview for " + ", ".join(
            f"{place['name']}, {place.get('countryCode', '')}" for place in places
        )
        lookups = [
            client.search(geography_query[:500], 3) for client in (self.maps, self.tavily) if client
        ]
        results = await asyncio.gather(
            self.store.search(request, query), *lookups, return_exceptions=True
        )
        offers = results[0]
        if isinstance(offers, BaseException):
            raise ValueError("source_unavailable") from None
        normalized = cast(dict[str, object], offers)
        # Retain only bounded, attributed advisory facts; no source text is an instruction.
        facts: list[dict[str, object]] = []
        for result in results[1:]:
            if isinstance(result, list):
                for fact in result:
                    facts.append(
                        {"text": fact.text, "sourceUrl": fact.source_url, "verified": False}
                    )
        return {**normalized, "researchFacts": facts[:6]}
