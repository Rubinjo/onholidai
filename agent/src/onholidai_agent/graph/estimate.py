import asyncio
import json
import re
from collections.abc import Awaitable, Callable
from contextlib import AbstractContextManager
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
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


class MaterialChoice(ValueError):
    def __init__(self, question: str, reason: str = "feasibility"):
        super().__init__(question)
        self.reason = reason


def facts(value: object) -> dict[str, object]:
    return cast(dict[str, object], value) if isinstance(value, dict) else {}


def rail_deferred(request: CreateAgentRunRequest) -> bool:
    candidates = [
        request.message,
        *[
            entry.redacted_content
            for entry in reversed(request.context.recent_messages)
            if entry.role == "user"
        ],
    ]
    if request.context.conversation_summary:
        candidates += list(reversed(request.context.conversation_summary.decisions))
    for text in candidates:
        if re.search(r"\b(?:rail|train)\b", text, re.I):
            return bool(
                re.search(r"\bkeep rail unresolved\b", text, re.I)
                and not re.search(r"\b(?:not|never|don't|do not)\b", text, re.I)
            )
    return False


def required_rail_question(snapshot: dict[str, object], *, deferred: bool = False) -> str | None:
    if deferred:
        return None
    constraints = cast(list[dict[str, object]], snapshot.get("constraints", []))
    required = any(
        entry.get("priority") == "required"
        and entry.get("status") != "removed"
        and entry.get("category") in (None, "transport")
        and re.search(r"\b(?:rail|train)\b", str(entry.get("statement", "")), re.I)
        for entry in constraints
    )
    confirmed = any(
        entry.get("type") == "rail" and entry.get("bookingStatus") == "confirmed"
        for entry in cast(list[dict[str, object]], snapshot.get("components", []))
    )
    if required and not confirmed:
        return (
            "Rail inventory is unsupported and your required rail leg remains unresolved. "
            "Should I keep rail unresolved while planning the supported parts, or would "
            "you like to revise that requirement?"
        )
    return None


def required_budget(snapshot: dict[str, object]) -> int | None:
    constraints = [
        entry
        for entry in cast(list[dict[str, object]], snapshot.get("constraints", []))
        if entry.get("status") != "removed"
    ]
    currency = facts(snapshot.get("price")).get("currency")
    budget: int | None = None
    for constraint in constraints:
        if constraint.get("category") != "budget" or constraint.get("priority") != "required":
            continue
        match = re.search(
            r"\b([A-Z]{3})\s+(\d+(?:\.\d{1,3})?)\b", str(constraint.get("statement", ""))
        )
        precision = {
            "EUR": 2,
            "GBP": 2,
            "USD": 2,
            "CAD": 2,
            "AUD": 2,
            "CHF": 2,
            "JPY": 0,
            "KRW": 0,
            "KWD": 3,
            "BHD": 3,
        }
        if (
            not match
            or match[1] != currency
            or match[1] not in precision
            or not re.search(
                r"\b(?:max(?:imum)?|at most|up to|not exceed|no more than|under|within|budget)\b",
                str(constraint.get("statement", "")),
                re.I,
            )
            or len(re.findall(r"\b[A-Z]{3}\s+\d", str(constraint.get("statement", "")))) != 1
        ):
            raise MaterialChoice(
                "What maximum total and currency should the recorded budget use?", "price"
            )
        amount = Decimal(match[2]) * 10 ** precision[match[1]]
        if (
            amount != amount.to_integral_value()
            or amount > 9007199254740991
            or ("." in match[2] and len(match[2].split(".")[1]) > precision[match[1]])
        ):
            raise MaterialChoice(
                "What exact total budget in the trip currency should I use?", "price"
            )
        budget = min(budget, int(amount)) if budget is not None else int(amount)
    return budget


def select_quotes(
    offers: list[dict[str, object]],
    spend: int,
    *,
    snapshot: dict[str, object] | None = None,
    query: dict[str, object] | None = None,
    allow_unresolved_rail: bool = False,
) -> list[dict[str, object]]:
    snapshot, query = snapshot or {}, query or {}
    rail = required_rail_question(snapshot, deferred=allow_unresolved_rail)
    if rail:
        raise MaterialChoice(rail)
    constraints = [
        entry
        for entry in cast(list[dict[str, object]], snapshot.get("constraints", []))
        if entry.get("status") != "removed"
    ]
    party = facts(snapshot.get("travellerParty"))
    children = cast(list[dict[str, object]], party.get("children", []))
    currency = facts(snapshot.get("price")).get("currency")
    budget = required_budget(snapshot)
    groups: dict[str, list[dict[str, object]]] = {}
    unknown: set[str] = set()
    fits: dict[int, tuple[int, ...]] = {}
    for offer in offers:
        if not complete_planning_component(offer.get("component")):
            continue
        raw_evidence = offer.get("evidence")
        if isinstance(raw_evidence, dict):
            evidence = cast(dict[str, object], raw_evidence)
            if evidence.get("status") == "expired" or evidence.get("availability") != "available":
                continue
        component = cast(dict[str, object], offer["component"])
        kind = str(component["type"])
        group = str(offer.get("selectionGroup", kind))
        expiry = facts(raw_evidence).get("expiresAt") or component.get("expiresAt")
        if isinstance(expiry, str) and datetime.fromisoformat(expiry) <= datetime.now(UTC):
            continue
        if currency and facts(component["price"]).get("currency") != currency:
            continue
        if (
            budget is not None
            and cast(int, facts(component["price"])["finalCustomerMinor"]) > budget
        ):
            continue
        if (
            query.get("startDate") and str(component["serviceStart"])[:10] < str(query["startDate"])
        ) or (query.get("endDate") and str(component["serviceEnd"])[:10] > str(query["endDate"])):
            continue
        eligibility, occupancy = facts(offer.get("eligibility")), facts(offer.get("occupancy"))
        if eligibility.get("status") == "ineligible":
            continue
        minimum_age, maximum_age = eligibility.get("minimumAge"), eligibility.get("maximumAge")
        if any(
            isinstance(child.get("ageAtTripStart"), int)
            and (
                (isinstance(minimum_age, int) and cast(int, child["ageAtTripStart"]) < minimum_age)
                or (
                    isinstance(maximum_age, int)
                    and cast(int, child["ageAtTripStart"]) > maximum_age
                )
            )
            for child in children
        ):
            continue
        adults = occupancy.get("maximumAdults")
        maximum_children = occupancy.get("maximumChildren")
        if kind == "accommodation" and (
            (isinstance(adults, int) and adults < cast(int, party.get("adults", 0)))
            or (isinstance(maximum_children, int) and maximum_children < len(children))
        ):
            continue
        if children and eligibility.get("status") != "eligible":
            unknown.add(group)
            continue
        if kind == "accommodation" and party and (adults is None or maximum_children is None):
            unknown.add(group)
            continue
        evidence = cast(
            list[dict[str, object]],
            facts(component.get("planningDetails")).get("constraintEvidence", []),
        )
        rejected, unresolved = False, False
        for constraint in constraints:
            category = constraint.get("category")
            scoped_types = {
                component_type
                for component_type, pattern in (
                    ("flight", r"\bflights?\b"),
                    ("activity", r"\b(?:activities|activity)\b"),
                    ("accommodation", r"\b(?:stays?|hotels?|accommodation)\b"),
                    ("transfer", r"\btransfers?\b"),
                    ("rail", r"\b(?:rail|trains?)\b"),
                )
                if re.search(pattern, str(constraint.get("statement", "")), re.I)
            }
            if (
                allow_unresolved_rail
                and category in (None, "transport")
                and re.search(r"\b(?:rail|train)\b", str(constraint.get("statement", "")), re.I)
            ):
                continue
            relevant = (
                category == "accessibility"
                or (category == "lodging" and kind == "accommodation")
                or (
                    category in ("dietary", "schedule")
                    and (
                        kind in scoped_types
                        if scoped_types
                        else category == "schedule" or kind == "activity"
                    )
                )
                or (category == "transport" and kind in ("flight", "transfer"))
                or category in ("other", "occasion")
            )
            if not relevant or constraint.get("priority") != "required":
                continue
            proof = next(
                (
                    entry.get("status")
                    for entry in evidence
                    if entry.get("constraintId") == constraint.get("id")
                ),
                None,
            )
            if category == "accessibility":
                if offer.get("accessibility") == "unsupported":
                    proof = "failed"
                elif offer.get("accessibility") == "verified" and proof != "failed":
                    proof = "verified"
            rejected |= proof == "failed"
            unresolved |= proof not in ("verified", "failed")
        if rejected:
            continue
        if unresolved:
            unknown.add(group)
            continue
        fits[id(offer)] = tuple(
            sum(
                1
                for constraint in constraints
                if constraint.get("priority") == priority
                and any(
                    entry.get("constraintId") == constraint.get("id")
                    and entry.get("status") == "verified"
                    for entry in evidence
                )
            )
            for priority in ("strong", "preference")
        )
        if kind != "accommodation" and any(
            entry.get("bookingStatus") in ("confirmed", "pending", "unknown")
            and entry.get("type") != "accommodation"
            and entry.get("id") != component.get("id")
            and str(entry.get("serviceStart")) < str(component["serviceEnd"])
            and str(entry.get("serviceEnd")) > str(component["serviceStart"])
            for entry in cast(list[dict[str, object]], snapshot.get("components", []))
        ):
            continue
        groups.setdefault(group, []).append(offer)

    def cost(offer: dict[str, object]) -> int:
        component = cast(dict[str, object], offer["component"])
        return cast(int, cast(dict[str, object], component["price"])["finalCustomerMinor"])

    selected: list[dict[str, object]] = []
    for options in groups.values():
        best_fit = max(fits[id(option)] for option in options)
        options = [option for option in options if fits[id(option)] == best_fit]
        pace = facts(snapshot.get("preferences")).get("pace", 50)
        duration_values = [
            facts(facts(option["component"]).get("planningDetails")).get("durationMinutes")
            for option in options
        ]
        if (
            isinstance(pace, int)
            and pace < 34
            and len(options) > 1
            and all(isinstance(value, int) for value in duration_values)
            and len(set(duration_values)) > 1
        ):
            shortest = min(cast(list[int], duration_values))
            relaxed = [
                option
                for option, value in zip(options, duration_values, strict=True)
                if value == shortest
            ]
            if spend >= 34 or min(cost(option) for option in relaxed) == min(
                cost(option) for option in options
            ):
                options = relaxed

        def terms(offer: dict[str, object]) -> str:
            # Only the offered conditions are a material trade-off. Schedules, hotel names
            # and provider fare strings differ across every sourced option, and asking
            # about them would force a question the policy resolves by total instead.
            return json.dumps(facts(offer["component"]).get("cancellationTerms"), sort_keys=True)

        if len({terms(option) for option in options}) > 1:
            raise MaterialChoice(
                "The sourced options differ in their cancellation terms. "
                "Which matters more for this choice: the lower total or those terms?",
                "experience",
            )
        # Spend is willingness, not evidence of quality or an invented monetary budget.
        selected.append(
            min(
                options,
                key=lambda option: (
                    cost(option),
                    str(facts(option["component"]).get("provider", "")),
                    str(facts(option["component"]).get("supplierOfferId", "")),
                ),
            )
        )
    unresolved_groups = unknown - groups.keys()
    if unresolved_groups:
        raise MaterialChoice(
            "Required eligibility or constraint evidence is unknown for "
            + ", ".join(sorted(unresolved_groups))
            + ". Which sourced option can meet the recorded requirement before it is selected?"
        )
    if budget is not None and (not selected or sum(cost(offer) for offer in selected) > budget):
        raise MaterialChoice(
            "Current sourced totals exceed the recorded trip budget. "
            "Should we change the route or revise that budget?",
            "price",
        )
    return selected


def decision_clarification(choice: MaterialChoice) -> AgentResult:
    return AgentResult.model_validate(
        {
            "kind": "clarification",
            "message": "Current source facts leave a material planning choice unresolved.",
            "clarification": {
                "id": str(uuid4()),
                "question": str(choice),
                "materialReason": choice.reason,
            },
        }
    )


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

        try:
            advice = redact_for_langsmith(await sources.model.complete(context), production=False)
        except (ValueError, TimeoutError, KeyError, httpx.HTTPError):
            # The deterministic estimate never depends on the advisory summary.
            advice = ""
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
    # Suppliers reject departures in the past, so a window that has already begun only
    # offers the days that remain. At least the minimum duration must still fit.
    today = now.date()
    feasible = [
        (window, max(date.fromisoformat(window["startDate"]), today))
        for window in windows
        if date.fromisoformat(window["endDate"])
        >= today + timedelta(days=duration["minimumDays"] - 1)
    ]
    if not feasible:
        return AgentResult.model_validate(
            {
                "kind": "clarification",
                "message": (
                    "Your saved travel dates are in the past, so there are no days left to plan."
                ),
                "clarification": {
                    "id": str(uuid4()),
                    "question": (
                        "Your saved travel dates are in the past, so there are no days left to "
                        f"plan. Which future dates can you travel for at least "
                        f"{duration['minimumDays']} days? Update your dates and duration in "
                        "setup, then retry the estimate."
                    ),
                    "materialReason": "feasibility",
                },
            }
        )
    window, start = next(
        (entry for entry in feasible if entry[0]["preference"] == "preferred"), feasible[0]
    )
    ideal_days = duration["idealDays"]
    available_days = (date.fromisoformat(window["endDate"]) - start).days + 1
    planned_days = min(ideal_days, available_days)
    duration = {**duration, "idealDays": planned_days}
    end = start + timedelta(days=planned_days - 1)
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
        planned_days = min(duration["maximumDays"], available_days)
        duration = {**duration, "idealDays": planned_days}
        end = start + timedelta(days=planned_days - 1)
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
    sourced = cast(list[dict[str, object]], found.get("offers", []))
    if not sourced and len(alternatives) <= 1:
        raise ValueError("source_unavailable")
    preferences = cast(dict[str, int], snapshot["preferences"])
    try:
        offers = select_quotes(
            sourced,
            preferences.get("spend", 50),
            snapshot=snapshot,
            query=query,
            allow_unresolved_rail=rail_deferred(request),
        )
    except MaterialChoice as choice:
        return decision_clarification(choice)
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
                    snapshot=snapshot,
                    query=query,
                    allow_unresolved_rail=rail_deferred(request),
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
        if not offers:
            if sourced:
                # Inventory exists but no offer established a complete customer price.
                # Report that instead of failing as if the sources had nothing.
                researched = sorted(
                    {
                        str(cast(dict[str, object], offer["component"]).get("type"))
                        for offer in sourced
                    }
                )
                return AgentResult.model_validate(
                    {
                        "kind": "answer",
                        "message": "Supplier research returned "
                        f"{len(sourced)} offer(s) for {', '.join(researched)}, but none "
                        "established a complete customer price with verified fees and terms. "
                        "No incomplete component or zero-cost trip was proposed. Review the "
                        "unresolved price and eligibility facts before booking; no inventory "
                        "was reserved.",
                    }
                )
            raise ValueError("source_unavailable")
        return AgentResult.model_validate(
            {
                "kind": "answer",
                "message": "Useful supplier research is available for "
                + ", ".join(sorted(str(kind) for kind in types))
                + ". Other required transport or stay facts remain unknown, so no incomplete "
                "component or zero-cost complete trip was proposed. Review source prerequisites "
                "and current research; no inventory was reserved.",
            }
        )
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
    if planned_days < ideal_days:
        warnings.append(
            f"Your availability window no longer has {ideal_days} days left, so the plan starts "
            f"{start} and uses the {planned_days} remaining days. Update your dates to change this."
        )
    if required_rail_question(snapshot):
        warnings.append(
            "Required rail remains unresolved and unchanged. Only supported parts were planned; "
            "no rail time, price or substitute leg was invented."
        )
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
                "unsupported",
                "unconfigured",
                "access_blocked",
                "rate_limited",
                "deadline",
                "error",
                "no_matches",
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
            else (
                "remaining availability window days "
                if planned_days < ideal_days
                else "ideal duration "
            )
        )
        + "without changing your duration preferences "
        "and preserves all availability windows. Return defaults to your confirmed origin."
    )
    rationale += origin_notes
    rationale += (
        " Selection respects sourced eligibility, party, dates, recorded constraints and "
        "explicit budget. Known preference fit precedes equivalent-price comparison; "
        "equivalent ties use provider then offer ID. A higher spend preference is not "
        "evidence of better quality. Unknown source facts remain unverified."
    )
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
    flexible = [entry for entry in feasible if entry[0]["preference"] == "flexible"]
    if flexible:
        rationale += (
            " Flexible-date windows remain alternatives; no cheaper fare is claimed "
            "without comparable supplier evidence."
        )
        alternative_start = flexible[0][1]
        alternative_end = min(
            alternative_start + timedelta(days=duration["idealDays"] - 1),
            date.fromisoformat(flexible[0][0]["endDate"]),
        )
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
                snapshot=snapshot,
                query={
                    **query,
                    "startDate": alternative_start.isoformat(),
                    "endDate": alternative_end.isoformat(),
                },
                allow_unresolved_rail=rail_deferred(request),
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
