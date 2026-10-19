import asyncio
import re
from datetime import datetime
from typing import Protocol, cast

from onholidai_agent.models.api import CreateAgentRunRequest


class ResearchReader(Protocol):
    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]: ...


def complete_planning_component(value: object) -> bool:
    """Discovery may be incomplete; only known component facts enter proposals."""
    if not isinstance(value, dict):
        return False
    component = cast(dict[str, object], value)
    if component.get("type") not in ("flight", "accommodation", "activity", "transfer"):
        return False
    if component.get("offerStatus", "available") != "available":
        return False
    start, end = component.get("serviceStart"), component.get("serviceEnd")
    if not isinstance(start, str) or not isinstance(end, str):
        return False
    try:
        if datetime.fromisoformat(end) < datetime.fromisoformat(start):
            return False
    except (ValueError, TypeError):
        return False
    details, terms = component.get("details"), component.get("cancellationTerms")
    if not isinstance(details, dict) or not isinstance(terms, str) or not terms.strip():
        return False
    raw_price = component.get("price")
    if not isinstance(raw_price, dict):
        return False
    price = cast(dict[str, object], raw_price)
    if price.get("status") == "expired":
        return False
    currency = price.get("currency")
    if not isinstance(currency, str) or re.fullmatch("[A-Z]{3}", currency) is None:
        return False
    for field in ("finalCustomerMinor", "taxesMinor", "feesMinor"):
        amount = price.get(field)
        if type(amount) is not int or not 0 <= amount <= 9007199254740991:
            return False
    return True


async def research(
    reader: ResearchReader, request: CreateAgentRunRequest, query: dict[str, object]
) -> dict[str, object]:
    async with asyncio.timeout(8):
        result = await reader.search(request, query)
    return result
