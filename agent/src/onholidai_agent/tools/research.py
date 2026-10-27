import asyncio
import re
from datetime import datetime
from typing import Protocol, cast, runtime_checkable

from onholidai_agent.models.api import CreateAgentRunRequest


class ResearchReader(Protocol):
    async def search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]: ...


@runtime_checkable
class SelectedResearchReader(Protocol):
    async def selected_offers(self, request: CreateAgentRunRequest) -> list[dict[str, object]]: ...


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
    planning_details = component.get("planningDetails")
    # Discovery offers carry their bounded supplier facts in planningDetails and keep
    # the raw details object empty by design. Either form proves the offer is sourced;
    # missing terms stay recorded in the offer's unverified facts.
    sourced = (isinstance(details, dict) and isinstance(terms, str) and bool(terms.strip())) or (
        details is None
        and isinstance(planning_details, dict)
        and isinstance(cast(dict[str, object], planning_details).get("fareConditions"), str)
        and bool(str(cast(dict[str, object], planning_details)["fareConditions"]).strip())
    )
    if not sourced:
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
    total = price.get("finalCustomerMinor")
    if type(total) is not int or not 0 <= total <= 9007199254740991:
        return False
    # Supplier fee and tax lines stay null when the offer does not establish them.
    # The total the traveller pays remains authoritative, so an unknown breakdown
    # line does not hide inventory from a priced proposal; the null field is the
    # machine-readable record that the breakdown is unverified.
    for field in ("taxesMinor", "feesMinor"):
        amount = price.get(field)
        if amount is not None and (type(amount) is not int or not 0 <= amount <= 9007199254740991):
            return False
    return True


async def research(
    reader: ResearchReader, request: CreateAgentRunRequest, query: dict[str, object]
) -> dict[str, object]:
    # Web bounds each supplier read to eight seconds and the whole research
    # request to twelve, so this client must allow the documented request bound
    # rather than cutting off a source that is already enforcing its own deadline.
    async with asyncio.timeout(12):
        result = await reader.search(request, query)
    return result
