import asyncio
import re
from datetime import UTC, date, datetime, time, timedelta
from typing import cast
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import langsmith
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]

from onholidai_agent.graph.clarify import question
from onholidai_agent.graph.estimate import (
    EstimateGraph,
    EstimateState,
    rail_deferred,
    required_rail_question,
)
from onholidai_agent.models.api import AgentResult, CreateAgentRunRequest
from onholidai_agent.tools.get_trip import TripReader, get_trip
from onholidai_agent.tools.itinerary_details import itinerary_details
from onholidai_agent.tools.propose_trip_changes import propose_trip_changes


async def finalize(request: CreateAgentRunRequest, sources: TripReader) -> AgentResult:
    async def compose(state: EstimateState) -> dict[str, AgentResult]:
        return {"result": await compose_itinerary(state["request"], sources)}

    graph = cast(EstimateGraph, StateGraph(EstimateState))
    graph.add_node("finalize", compose)
    graph.add_edge(START, "finalize")
    graph.add_edge("finalize", END)
    with langsmith.tracing_context(enabled=False):  # pyright: ignore[reportUnknownMemberType]
        async with asyncio.timeout(30):
            result = await graph.compile().ainvoke({"request": request})
    value = result.get("result")
    if value is None:
        raise ValueError("missing_itinerary_result")
    return value


async def compose_itinerary(request: CreateAgentRunRequest, sources: TripReader) -> AgentResult:
    trip = await get_trip(sources, request)
    snapshot = cast(dict[str, object], trip["snapshot"])
    rail = required_rail_question(snapshot, deferred=rail_deferred(request))
    if rail:
        return question(rail, "feasibility")
    planned = build_itinerary_days(snapshot, request.message, request.request_id)
    if isinstance(planned, str):
        return question(planned, "feasibility")
    days, warnings = planned
    return propose_trip_changes(
        request,
        [{"operation": "replace", "target": "/itineraryDays", "value": days}],
        "Build a day-by-day plan from the accepted route and exact component times. "
        "Preserve traveller choices; review lower-priority suggestions and all "
        "policy conflicts before finalization.",
        warnings,
    )


TRAVEL_PREPARATION_MINUTES = {"flight": 180, "rail": 30, "ferry": 30}
TRAVEL_GUIDANCE = (
    "Planning defaults: arrive 180 minutes before international flights, "
    "120 domestic, 30 rail/ferry; verify carrier requirements."
)


def utc_offset(moment: datetime) -> str:
    value = moment.strftime("%z")
    return value[:3] + ":" + value[3:]


def supplier_zone(value: object) -> ZoneInfo | None:
    """A supplier zone is usable only when it names a real IANA region."""
    if not isinstance(value, str) or not value:
        return None
    try:
        return ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        return None


def parse_moment(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def flight_journeys(component: dict[str, object]) -> list[object]:
    """Journeys a fare flies, when the source published per-flight times."""
    planning = component.get("planningDetails")
    raw = (
        cast(dict[str, object], planning).get("flightJourneys")
        if isinstance(planning, dict)
        else None
    )
    return cast(list[object], raw) if isinstance(raw, list) else []


def travel_windows(component: dict[str, object]) -> list[dict[str, object]]:
    """One window per flown direction.

    A fare can cover an outbound and a return slice, so its whole-trip span must never
    be read as a single flight: the days between the slices are not flight time.
    """
    raw = flight_journeys(component)
    if raw:
        windows: list[dict[str, object]] = []
        for entry in raw:
            if not isinstance(entry, dict):
                return []
            journey = cast(dict[str, object], entry)
            departing = parse_moment(journey.get("departingAt"))
            arriving = parse_moment(journey.get("arrivingAt"))
            origin = journey.get("origin")
            destination = journey.get("destination")
            if (
                departing is None
                or arriving is None
                or arriving <= departing
                or not isinstance(origin, str)
                or not isinstance(destination, str)
            ):
                # An unreadable journey is not evidence for a longer flight.
                return []
            windows.append(
                {
                    "departing": departing,
                    "arriving": arriving,
                    "origin": origin,
                    "destination": destination,
                    "originZone": supplier_zone(journey.get("originTimezone")),
                    "destinationZone": supplier_zone(journey.get("destinationTimezone")),
                }
            )
        return windows
    details = cast(dict[str, object], component.get("details") or {})
    departing, arriving = parse_moment(component.get("serviceStart")), parse_moment(
        component.get("serviceEnd")
    )
    if departing is None or arriving is None or arriving <= departing:
        return []
    return [
        {
            "departing": departing,
            "arriving": arriving,
            "origin": str(
                details.get("originStation")
                or details.get("origin")
                or "Departure location unavailable"
            ),
            "destination": str(
                details.get("destinationStation")
                or details.get("destination")
                or "Arrival location unavailable"
            ),
            "originZone": None,
            "destinationZone": None,
        }
    ]


def build_itinerary_days(
    snapshot: dict[str, object], message: str, request_id: str
) -> tuple[list[dict[str, object]], list[str]] | str:
    """Builds the day plan from accepted trip facts.

    Returns the bounded question text when a material date, timezone or route fact is
    still missing, so both finalization and activity planning ask the same thing.
    """
    destinations = cast(list[dict[str, object]], snapshot["destinations"])
    preferences = cast(dict[str, int], snapshot["preferences"])
    components = cast(list[dict[str, object]], snapshot.get("components", []))
    zones: dict[str, ZoneInfo] = {}
    for destination in destinations:
        explicit = re.search(
            re.escape(str(destination["name"])) + r"\s*[:=]\s*([A-Za-z_]+/[A-Za-z_/]+)",
            message,
        )
        timezone = explicit.group(1) if explicit else destination.get("timezone")
        if not isinstance(timezone, str):
            return (
                f"Which IANA timezone applies to {destination['name']}? "
                f"Reply with {destination['name']}: Area/City."
            )
        try:
            zones[str(destination["id"])] = ZoneInfo(timezone)
        except ZoneInfoNotFoundError:
            return f"Which valid IANA timezone applies to {destination['name']}?"
        if not destination.get("arrivalDate") or not destination.get("departureDate"):
            return "Accept a dated destination route before preparing the itinerary."
    first = min(str(entry["arrivalDate"]) for entry in destinations)
    last = max(str(entry["departureDate"]) for entry in destinations)
    start_date, end_date = date.fromisoformat(first), date.fromisoformat(last)
    if not 0 <= (end_date - start_date).days < 366:
        return "Which ordered dates within the trip limit should the itinerary use?"
    trip_dates = {
        (start_date + timedelta(days=offset)).isoformat()
        for offset in range((end_date - start_date).days + 1)
    }
    days: list[dict[str, object]] = []
    warnings = [
        "Planning only: generated timing, directions and suggestions require verification.",
        "Web checks feasibility policy v1 before finalization; "
        "accepting this proposal does not finalize or book.",
    ]
    if required_rail_question(snapshot):
        warnings.append(
            "Required rail remains unresolved; supported itinerary timing "
            "does not satisfy or replace that requirement."
        )
    for component in components:
        # A fare saved before per-flight journey facts existed exposes only its overall
        # window, so a round trip would read as one flight lasting days. Say so instead
        # of presenting the span as a flight time; a refresh replaces it with journeys.
        if component["type"] != "flight" or flight_journeys(component):
            continue
        departing = parse_moment(component.get("serviceStart"))
        arriving = parse_moment(component.get("serviceEnd"))
        if departing and arriving and arriving - departing > timedelta(hours=24):
            warnings.append(
                f"The saved flight fare {component['provider']!s} covers more than one "
                "flight but only its overall window is stored. Refresh the flights before "
                "finalizing so each direction gets its own dates and duration."
            )
    for offset in range((end_date - start_date).days + 1):
        local_date = (start_date + timedelta(days=offset)).isoformat()
        stops = [
            entry
            for entry in destinations
            if str(entry["arrivalDate"]) <= local_date <= str(entry["departureDate"])
        ]
        if not stops:
            return "Resolve the gap between destination dates before preparing the itinerary."
        destination = stops[-1]
        zone = zones[str(destination["id"])]
        items: list[dict[str, object]] = []

        def item(
            kind: str,
            begin: str,
            finish: str,
            title: str,
            component: dict[str, object] | None = None,
            local_date: str = local_date,
            location: object = destination.get("location"),
        ) -> dict[str, object]:
            # Second precision matches component times so the feasibility policy never
            # reports a false overlap between a block and an adjacent fixed service.
            def instant(clock: str) -> str:
                return clock if len(clock) >= 19 else f"{clock}:00"

            return {
                "id": str(uuid5(NAMESPACE_URL, request_id + local_date + kind + begin + title)),
                "type": kind,
                "title": title,
                "start": instant(begin),
                "end": instant(finish),
                "location": location,
                "componentId": component["id"] if component else None,
                "constraintChecks": [],
                "constraintEvidence": [],
                "status": "planned",
                "travelSegment": None,
                "priority": "required" if component else "preference",
                "verificationStatus": "unverified",
                "timingEvidence": [],
                "durationUpperBoundMinutes": None,
                "feasibilityPolicyVersion": "1",
                "practicalNotes": [
                    "Verify opening times, dietary/accessibility needs and local directions."
                ],
            }

        def travel(
            component: dict[str, object],
            window: dict[str, object],
            day: ZoneInfo,
            day_date: str,
        ) -> dict[str, object] | None:
            mode = (
                "flight"
                if component["type"] == "flight"
                else "rail" if component["type"] == "rail" else "transfer"
            )
            departing = cast(datetime, window["departing"])
            arriving = cast(datetime, window["arriving"])
            origin_zone = cast("ZoneInfo | None", window["originZone"]) or day
            destination_zone = cast("ZoneInfo | None", window["destinationZone"]) or day
            origin, destination_name = str(window["origin"]), str(window["destination"])
            # Reserve airport/station preparation before the exact accepted departure,
            # but never move the block onto the day before the traveller's plan starts.
            midnight = datetime.combine(date.fromisoformat(day_date), time(), tzinfo=day)
            start = departing.astimezone(day) - timedelta(
                minutes=TRAVEL_PREPARATION_MINUTES.get(mode, 0)
            )
            finish = arriving.astimezone(day)
            start = max(start, midnight)
            if finish <= start:
                return None
            value = item(
                "travel",
                start.isoformat()[:19],
                finish.isoformat()[:19],
                f"{mode} — {origin} → {destination_name}"[:200],
                component,
            )
            value["startOffset"], value["endOffset"] = utc_offset(start), utc_offset(finish)
            value["travelSegment"] = {
                "mode": mode,
                # Local departure and arrival clocks belong to their own airports, not
                # to the day's stop, so a return leg never borrows the destination zone.
                "origin": {
                    "placeId": str(component["id"]) + "-origin",
                    "name": origin[:120],
                    "timezone": origin_zone.key,
                    "location": None,
                },
                "destination": {
                    "placeId": str(component["id"]) + "-destination",
                    "name": destination_name[:120],
                    "timezone": destination_zone.key,
                    "location": None,
                },
                "plannedDeparture": departing.astimezone(origin_zone).isoformat(),
                "plannedArrival": arriving.astimezone(destination_zone).isoformat(),
                "durationMinutes": max(1, round((arriving - departing).total_seconds() / 60)),
                "durationUpperBoundMinutes": None,
                "routeGeometry": None,
                "directionsSummary": "Directions unavailable; "
                "verify terminals, route and travel from stay.",
                "source": str(component["provider"]),
                "freshnessAt": component["checkedAt"],
                "timingEvidence": [],
                "verificationStatus": "unverified",
                "feasibilityPolicyVersion": "1",
                "international": True,
                "departureGuidance": TRAVEL_GUIDANCE,
            }
            return value

        for component in components:
            if component["type"] == "accommodation":
                continue
            kind = "activity" if component["type"] == "activity" else "travel"
            if kind == "activity":
                facts = itinerary_details(component)
                begin = datetime.fromisoformat(str(facts["serviceStart"])).astimezone(zone)
                finish = datetime.fromisoformat(str(facts["serviceEnd"])).astimezone(zone)
                if begin.date().isoformat() != local_date:
                    continue
                named = cast(dict[str, object], component.get("planningDetails") or {}).get(
                    "locationName"
                )
                title = (
                    named.strip()
                    if isinstance(named, str) and named.strip()
                    else "Booked activity — accepted estimated component"
                )
                value = item(
                    kind,
                    begin.isoformat()[:19],
                    finish.isoformat()[:19],
                    title,
                    component,
                )
                value["startOffset"], value["endOffset"] = utc_offset(begin), utc_offset(finish)
                items.append(value)
                continue
            for window in travel_windows(component):
                # A journey belongs to the day the traveller leaves, unless that day is
                # outside the plan; an overnight arrival then lands on its own day.
                departing = cast(datetime, window["departing"])
                arriving = cast(datetime, window["arriving"])
                departure_day = departing.astimezone(zone).date().isoformat()
                arrival_day = arriving.astimezone(zone).date().isoformat()
                if (departure_day if departure_day in trip_dates else arrival_day) != local_date:
                    continue
                value = travel(component, window, zone, local_date)
                if value is not None:
                    items.append(value)
        # Everyday meals are the only generic blocks: they fit around accepted fixed
        # components and are omitted when a flight or excursion owns that part of the day.
        meals = [
            ("08:00", "Morning meal"),
            ("12:30", "Lunch"),
            ("18:00", "Evening meal"),
        ]
        for nominal, title in meals:
            duration = 45
            nominal_minute = int(nominal[:2]) * 60 + int(nominal[3:])
            # Nearest free slot to the usual hour, then the next closest, within ±2 hours.
            candidates = sorted(
                (
                    minute
                    for minute in range(nominal_minute - 120, nominal_minute + 120, 15)
                    if minute >= 0
                ),
                key=lambda minute: (abs(minute - nominal_minute), minute),
            )
            for minute in candidates:
                begin = local_date + f"T{minute // 60:02}:{minute % 60:02}"
                finish = (
                    local_date + f"T{(minute + duration) // 60:02}:{(minute + duration) % 60:02}"
                )
                if not any(
                    str(entry["start"]) < finish and str(entry["end"]) > begin for entry in items
                ):
                    items.append(item("meal", begin, finish, title))
                    break
        items.sort(key=lambda entry: str(entry["start"]))
        days.append(
            {
                "date": local_date,
                "destinationId": destination["id"],
                "timezone": zone.key,
                "paceAssessment": preferences["pace"],
                "items": items,
                "practicalNotes": [
                    "Only meals are generic placeholders; every other block comes from an "
                    "accepted supplier component. Preserve nine hours overnight rest.",
                    "Stay locations, return travel, baggage, fares and cancellation rules "
                    "remain subject to supplier verification.",
                ],
            }
        )
        if any(
            entry["type"] == "travel"
            and isinstance(entry["travelSegment"], dict)
            and cast(dict[str, object], entry["travelSegment"])["mode"]
            in ("flight", "rail", "ferry")
            and cast(int, cast(dict[str, object], entry["travelSegment"])["durationMinutes"]) >= 240
            for entry in items
        ):
            days[-1]["mandatoryTravelException"] = (
                "Mandatory long-distance travel may exceed ordinary pace/rest defaults. "
                "Review this exception; impossible connections "
                "and required constraints still block."
            )
    return days, warnings
