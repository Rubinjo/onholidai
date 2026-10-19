import asyncio
from collections.abc import Awaitable, Callable
from contextlib import AbstractContextManager
from datetime import UTC, date, datetime, timedelta
from typing import NotRequired, Protocol, TypedDict, cast
from uuid import uuid4

import httpx
import langsmith
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]

from onholidai_agent.context.build import build_context
from onholidai_agent.graph.route_policy import arrange_destinations
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.models.api import AgentResult, CreateAgentRunRequest
from onholidai_agent.tools.get_trip import TripReader, get_trip
from onholidai_agent.tools.propose_trip_changes import propose_trip_changes
from onholidai_agent.tools.research import (
    ResearchReader,
    complete_planning_component,
    research,
)


class Sources(TripReader, ResearchReader, Protocol):
    pass


def select_quotes(offers: list[dict[str, object]], spend: int) -> list[dict[str, object]]:
    groups: dict[str, list[dict[str, object]]] = {}
    for offer in offers:
        if not complete_planning_component(offer.get("component")):
            continue
        raw_evidence = offer.get("evidence")
        if isinstance(raw_evidence, dict):
            evidence = cast(dict[str, object], raw_evidence)
            if evidence.get("status") == "expired" or evidence.get("availability") != "available":
                continue
        component = cast(dict[str, object], offer["component"])
        group = str(offer.get("selectionGroup", component.get("type")))
        groups.setdefault(group, []).append(offer)

    def cost(offer: dict[str, object]) -> int:
        component = cast(dict[str, object], offer["component"])
        return cast(int, cast(dict[str, object], component["price"])["finalCustomerMinor"])

    selected: list[dict[str, object]] = []
    for options in groups.values():
        ranked = sorted(options, key=cost)
        selected.append(ranked[min(len(ranked) - 1, (len(ranked) - 1) * spend // 100)])
    return selected


class EstimateState(TypedDict):
    request: CreateAgentRunRequest
    result: NotRequired[AgentResult]


class CompiledEstimate(Protocol):
    async def ainvoke(self, value: EstimateState) -> EstimateState: ...


class EstimateGraph(Protocol):
    def add_node(
        self, name: str, action: Callable[[EstimateState], Awaitable[dict[str, AgentResult]]]
    ) -> object: ...
    def add_edge(self, origin: str, destination: str) -> object: ...
    def compile(self) -> CompiledEstimate: ...


class TraceController(Protocol):
    def __call__(self, *, enabled: bool) -> AbstractContextManager[None]: ...


async def estimate(
    request: CreateAgentRunRequest, sources: Sources, *, now: datetime | None = None
) -> AgentResult:
    async def compose(state: EstimateState) -> dict[str, AgentResult]:
        value = await _compose(state["request"], sources, now or datetime.now(UTC))
        return {"result": value}

    graph = cast(EstimateGraph, StateGraph(EstimateState))
    graph.add_node("estimate", compose)
    graph.add_edge(START, "estimate")
    graph.add_edge("estimate", END)
    # Disable implicit environment-driven tracing before raw state reaches an exporter.
    # Vendor metadata annotations are broad; this explicit boundary uses only enabled.
    trace_control = cast(
        TraceController,
        langsmith.tracing_context,  # pyright: ignore[reportUnknownMemberType]
    )
    with trace_control(enabled=False):
        async with asyncio.timeout(30):
            result = await graph.compile().ainvoke({"request": request})
    value = result.get("result")
    if value is None:
        raise ValueError("missing_estimate_result")
    return value


async def _compose(request: CreateAgentRunRequest, sources: Sources, now: datetime) -> AgentResult:
    trip = await get_trip(sources, request)
    context = build_context(request, trip)
    model_advice = ""
    if isinstance(sources, EstimateSources):
        # Model output is advisory only: no tool or operation from free text is ever executed.
        from onholidai_agent.telemetry.redaction import redact_for_langsmith

        advice = redact_for_langsmith(await sources.model.complete(context), production=False)
        model_advice = advice[:1000]
    snapshot = cast(dict[str, object], trip["snapshot"])
    origin_value = snapshot.get("departureOrigin")
    if (
        not isinstance(origin_value, dict)
        or cast(dict[str, object], origin_value).get("confirmedByUser") is not True
    ):
        return AgentResult.model_validate(
            {
                "kind": "clarification",
                "message": "Confirm your departure origin in setup.",
                "clarification": {
                    "id": str(uuid4()),
                    "question": "Which disambiguated city or airport will you depart from?",
                    "materialReason": "feasibility",
                },
            }
        )
    origin = cast(dict[str, object], origin_value)
    duration = cast(dict[str, int], snapshot["duration"])
    windows = cast(list[dict[str, str]], snapshot["availabilityWindows"])
    feasible = [
        window
        for window in windows
        if (date.fromisoformat(window["endDate"]) - date.fromisoformat(window["startDate"])).days
        + 1
        >= duration["idealDays"]
    ]
    if not feasible:
        raise ValueError("infeasible_duration")
    window = next((item for item in feasible if item["preference"] == "preferred"), feasible[0])
    start = date.fromisoformat(window["startDate"])
    end = start + timedelta(days=duration["idealDays"] - 1)
    destinations = cast(list[dict[str, object]], snapshot["destinations"])
    # Country selections define scope, not additional overnight stops where specific cities exist.
    city_countries = {
        place.get("countryCode") for place in destinations if place.get("kind") != "country"
    }
    destinations = [
        place
        for place in destinations
        if place.get("kind") != "country" or place.get("countryCode") not in city_countries
    ]
    if request.message.lower().strip().startswith("remove "):
        name = request.message.strip()[7:].casefold()
        matches = [place for place in destinations if str(place.get("name", "")).casefold() == name]
        if len(matches) == 1 and len(destinations) > 1:
            destinations = [place for place in destinations if place is not matches[0]]
    if request.message.lower().strip() == "use maximum duration":
        duration = {**duration, "idealDays": duration["maximumDays"]}
        end = start + timedelta(days=duration["idealDays"] - 1)
        if end > date.fromisoformat(window["endDate"]):
            raise ValueError("infeasible_duration")
    raw_alternatives = snapshot.get("departureOrigins")
    alternatives = (
        cast(list[dict[str, object]], raw_alternatives)
        if isinstance(raw_alternatives, list)
        else []
    )
    route_origins = alternatives or [origin]
    destinations = arrange_destinations(
        destinations, snapshot.get("destinationOrder", "manual"), route_origins
    )
    if duration["idealDays"] - 1 < len(destinations):
        return AgentResult.model_validate(
            {
                "kind": "clarification",
                "message": "The route needs more time.",
                "clarification": {
                    "id": str(uuid4()),
                    "question": (
                        "May I use your maximum duration? Reply 'use maximum duration', "
                        "or revise setup and retry."
                    ),
                    "materialReason": "feasibility",
                },
            }
        )
    query: dict[str, object] = {
        "startDate": start.isoformat(),
        "endDate": end.isoformat(),
        "destinationIds": [item["id"] for item in destinations],
    }
    found: dict[str, object] = {"offers": []}
    try:
        found = await research(sources, request, query)
    except (ValueError, TimeoutError, httpx.HTTPError):
        if len(alternatives) <= 1:
            raise
    offers = cast(list[dict[str, object]], found.get("offers", []))
    if not offers and len(alternatives) <= 1:
        raise ValueError("source_unavailable")
    preferences = cast(dict[str, int], snapshot["preferences"])
    offers = select_quotes(offers, preferences.get("spend", 50))
    origin_notes = ""
    if len(alternatives) > 1:

        async def compare(
            alternative: dict[str, object],
        ) -> tuple[dict[str, object], list[dict[str, object]]]:
            try:
                found_alternative = await research(
                    sources, request, {**query, "departurePlaceId": alternative["placeId"]}
                )
                selected = select_quotes(
                    cast(list[dict[str, object]], found_alternative.get("offers", [])),
                    preferences.get("spend", 50),
                )
                return alternative, selected
            except (ValueError, TimeoutError, KeyError, httpx.HTTPError):
                return alternative, []

        comparisons = await asyncio.gather(
            *(
                compare(alternative)
                for alternative in alternatives
                if alternative.get("placeId") != origin.get("placeId")
            )
        )

        def total(items: list[dict[str, object]]) -> int:
            return sum(
                cast(
                    int,
                    cast(dict[str, object], cast(dict[str, object], item["component"])["price"])[
                        "finalCustomerMinor"
                    ],
                )
                for item in items
            )

        def coverage(items: list[dict[str, object]]) -> list[str]:
            return sorted(
                str(item.get("selectionGroup", cast(dict[str, object], item["component"])["type"]))
                for item in items
            )

        reference = coverage(offers) if offers else []
        if not reference:
            for _, selected in comparisons:
                if selected:
                    reference = coverage(selected)
                    break
        comparable = [
            (alternative, selected)
            for alternative, selected in comparisons
            if selected and coverage(selected) == reference
        ]
        available = ([(origin, offers)] if offers else []) + comparable
        if not available:
            raise ValueError("source_unavailable")
        chosen_origin, chosen_offers = min(
            available,
            key=lambda item: total(item[1]),
        )
        origin = chosen_origin
        offers = chosen_offers
        query["departurePlaceId"] = origin["placeId"]
        origin_notes = (
            f" Compared {len(available)} departure alternatives. Review the recommended "
            f"departure from {origin.get('name', 'your confirmed origin')} "
            "and return to the same location."
        )
        if len(available) < len(alternatives):
            origin_notes += (
                " Some departure comparisons were unavailable or not comparable; "
                "no savings are claimed for those locations."
            )
    types = {cast(dict[str, object], offer["component"]).get("type") for offer in offers}
    if not types.intersection({"flight", "rail", "transfer"}) or (
        duration["idealDays"] > 1 and "accommodation" not in types
    ):
        raise ValueError("source_unavailable")
    routed: list[dict[str, object]] = []
    cursor = start
    nights, extra = divmod(duration["idealDays"] - 1, len(destinations))
    for index, destination in enumerate(destinations):
        count = nights + (1 if index < extra else 0)
        departure = cursor + timedelta(days=count)
        routed.append(
            {
                **destination,
                "routePosition": index,
                "arrivalDate": cursor.isoformat(),
                "departureDate": departure.isoformat(),
                "plannedNights": count,
            }
        )
        cursor = departure
    components = [offer["component"] for offer in offers]
    warnings = [
        "Source eligibility, occupancy, accessibility and cancellation facts require verification."
    ]
    if any(
        not complete_planning_component(offer.get("component"))
        for offer in cast(list[dict[str, object]], found.get("offers", []))
    ):
        warnings.append(
            "Incomplete or unsupported discovery offers were not added; "
            "missing facts remain unknown."
        )
    raw_outcomes = found.get("outcomes", [])
    if isinstance(raw_outcomes, list):
        for item in cast(list[object], raw_outcomes)[:16]:
            if not isinstance(item, dict):
                continue
            outcome = cast(dict[str, object], item)
            kind, status = outcome.get("componentType"), outcome.get("status")
            if kind in ("flight", "accommodation", "activity", "rail") and status in (
                "unsupported", "unconfigured", "access_blocked", "rate_limited",
                "deadline", "error", "no_matches",
            ):
                warnings.append(
                    f"Supplier {kind} research is {status}; related requirements remain "
                    "unresolved, with no replacement inventory assumed."
                )
    constraints = cast(list[dict[str, object]], snapshot.get("constraints", []))
    warnings.extend(
        f"Unverified {constraint['priority']} requirement: {str(constraint['statement'])[:850]}"
        for constraint in constraints
        if constraint.get("status") != "removed"
    )
    rationale = (
        f"A {duration['idealDays']}-day route uses your "
        + (
            "reviewed maximum duration to give the requested stops enough time "
            if request.message.lower().strip() == "use maximum duration"
            else "ideal duration "
        )
        + "without changing your duration preferences "
        "and preserves all availability windows. Return defaults to your confirmed origin."
    )
    rationale += origin_notes
    if snapshot.get("destinationOrder") == "ai":
        rationale += (
            " Destination order is an AI-proposed geographic circuit; departure/return "
            "legs and transport feasibility still require verification. Missing destination "
            "or confirmed-departure coordinates preserve the supplied order."
        )
    source_facts = cast(list[dict[str, object]], found.get("researchFacts", []))
    if source_facts:
        from onholidai_agent.telemetry.redaction import redact_for_langsmith

        rationale += " Unverified research context: " + "; ".join(
            redact_for_langsmith(
                f"{str(fact.get('text', ''))[:180]} (source: {fact.get('sourceUrl', '')})",
                production=False,
            )
            for fact in source_facts[:3]
        )
    flexible = [item for item in feasible if item["preference"] == "flexible"]
    if flexible:
        rationale += (
            " Flexible-date windows remain alternatives; no cheaper fare is claimed "
            "without comparable supplier evidence."
        )
        alternative_start = date.fromisoformat(flexible[0]["startDate"])
        alternative_end = alternative_start + timedelta(days=duration["idealDays"] - 1)
        try:
            alternative = await research(
                sources,
                request,
                {
                    **query,
                    "startDate": alternative_start.isoformat(),
                    "endDate": alternative_end.isoformat(),
                },
            )
            alternate_offers = select_quotes(
                cast(list[dict[str, object]], alternative.get("offers", [])),
                preferences.get("spend", 50),
            )

            def total(items: list[dict[str, object]]) -> int:
                return sum(
                    cast(
                        int,
                        cast(
                            dict[str, object], cast(dict[str, object], offer["component"])["price"]
                        )["finalCustomerMinor"],
                    )
                    for offer in items
                )

            comparable = len(alternate_offers) == len(offers) and len(offers) > 0
            if comparable and total(alternate_offers) < total(offers):
                currency = cast(dict[str, object], snapshot["price"])["currency"]
                rationale += (
                    f" Illustrative flexible alternative {alternative_start} to {alternative_end}: "
                    f"{total(offers) - total(alternate_offers)} minor units {currency} lower; "
                    "terms and availability are unverified. Preferred dates are unchanged."
                )
        except (ValueError, TimeoutError, KeyError):
            warnings.append("Flexible-date comparison is unavailable; no cheaper fare is claimed.")
    if model_advice:
        rationale += " Advisory model summary (unverified): " + model_advice
    return propose_trip_changes(
        request,
        [
            *(
                [{"operation": "replace", "target": "/departureOrigin", "value": origin}]
                if alternatives
                else []
            ),
            {"operation": "replace", "target": "/destinations", "value": routed},
            {"operation": "replace", "target": "/components", "value": components},
            {"operation": "replace", "target": "/itineraryDays", "value": []},
        ],
        rationale,
        warnings,
        now,
    )
