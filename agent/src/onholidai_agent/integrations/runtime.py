import asyncio
import json
from typing import cast

from fastmcp import Client

from onholidai_agent.api.store import RunStore
from onholidai_agent.models.api import AgentResult, CreateAgentRunRequest
from onholidai_agent.models.tools import SupplierSearchInput

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

    async def selected_offers(self, request: CreateAgentRunRequest) -> list[dict[str, object]]:
        from .supplier_mcp import supplier_server

        offers: list[dict[str, object]] = []
        async with asyncio.timeout(12), Client(supplier_server(self.store, request)) as client:
            for selected in request.selected_offers or []:
                response = await client.call_tool(
                    "supplier_offer_details",
                    {"offerRef": selected.offer_ref, "revision": selected.revision},
                )
                data = cast(dict[str, object], response.structured_content)
                offer = data.get("offer")
                if not isinstance(offer, dict):
                    raise ValueError("selected_offer_unavailable")
                offer = cast(dict[str, object], offer)
                if (
                    offer.get("offerRef") != selected.offer_ref
                    or offer.get("revision") != selected.revision
                ):
                    raise ValueError("selected_offer_unavailable")
                offers.append(offer)
        return offers

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


async def supplier_research(
    request: CreateAgentRunRequest,
    store: RunStore,
) -> AgentResult:
    from .supplier_mcp import supplier_server

    # The browser submits closed search arguments as the existing run message.
    # Web rechecks their dates, destinations and constraints against the current trip.
    query = SupplierSearchInput.model_validate_json(request.message)
    async with asyncio.timeout(12), Client(supplier_server(store, request)) as client:
        response = await client.call_tool(
            "supplier_search",
            query.model_dump(
                mode="json",
                by_alias=True,
                exclude_none=True,
                exclude_unset=True,
            ),
        )
    data = cast(dict[str, object], response.structured_content)
    offers = cast(list[dict[str, object]], data["offers"])
    references = [
        {"offerRef": offer["offerRef"], "revision": offer["revision"]} for offer in offers
    ]
    raw_outcomes = data.get("outcomes", [])
    outcomes: list[dict[str, object]] = []
    if isinstance(raw_outcomes, list):
        for item in cast(list[object], raw_outcomes)[:16]:
            if isinstance(item, dict):
                outcome = cast(dict[str, object], item)
                outcomes.append(
                    {
                        key: str(outcome[key])[:240]
                        for key in ("provider", "componentType", "status", "reason")
                        if key in outcome
                    }
                )
    message = json.dumps(
        {"offers": references, "outcomes": outcomes},
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return AgentResult.model_validate({"kind": "answer", "message": message})
