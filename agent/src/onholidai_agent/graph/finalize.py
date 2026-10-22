import asyncio
import re
from datetime import date, datetime, timedelta
from typing import cast
from uuid import NAMESPACE_URL, uuid5
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import langsmith
from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]

from onholidai_agent.graph.estimate import EstimateGraph, EstimateState
from onholidai_agent.graph.refine import question
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
    destinations = cast(list[dict[str, object]], snapshot["destinations"])
    preferences = cast(dict[str, int], snapshot["preferences"])
    components = cast(list[dict[str, object]], snapshot.get("components", []))
    zones: dict[str, ZoneInfo] = {}
    for destination in destinations:
        explicit = re.search(
            re.escape(str(destination["name"])) + r"\s*[:=]\s*([A-Za-z_]+/[A-Za-z_/]+)",
            request.message,
        )
        timezone = explicit.group(1) if explicit else destination.get("timezone")
        if not isinstance(timezone, str):
            return question(
                f"Which IANA timezone applies to {destination['name']}? "
                f"Reply with {destination['name']}: Area/City.",
                "feasibility",
            )
        try:
            zones[str(destination["id"])] = ZoneInfo(timezone)
        except ZoneInfoNotFoundError:
            return question(
                f"Which valid IANA timezone applies to {destination['name']}?", "feasibility"
            )
        if not destination.get("arrivalDate") or not destination.get("departureDate"):
            return question(
                "Accept a dated destination route before preparing the itinerary.", "feasibility"
            )
    first = min(str(entry["arrivalDate"]) for entry in destinations)
    last = max(str(entry["departureDate"]) for entry in destinations)
    start_date, end_date = date.fromisoformat(first), date.fromisoformat(last)
    if not 0 <= (end_date - start_date).days < 366:
        return question(
            "Which ordered dates within the trip limit should the itinerary use?", "feasibility"
        )
    days: list[dict[str, object]] = []
    warnings = [
        "Planning only: generated timing, directions and suggestions require verification.",
        "Web checks feasibility policy v1 before finalization; "
        "accepting this proposal does not finalize or book.",
    ]
    for offset in range((end_date - start_date).days + 1):
        local_date = (start_date + timedelta(days=offset)).isoformat()
        stops = [
            entry
            for entry in destinations
            if str(entry["arrivalDate"]) <= local_date <= str(entry["departureDate"])
        ]
        if not stops:
            return question(
                "Resolve the gap between destination dates before preparing the itinerary.",
                "feasibility",
            )
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
            return {
                "id": str(
                    uuid5(NAMESPACE_URL, request.request_id + local_date + kind + begin + title)
                ),
                "type": kind,
                "title": title,
                "start": begin,
                "end": finish,
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

        for component in components:
            if component["type"] == "accommodation":
                continue
            facts = itinerary_details(component)
            begin = datetime.fromisoformat(str(facts["serviceStart"])).astimezone(zone)
            finish = datetime.fromisoformat(str(facts["serviceEnd"])).astimezone(zone)
            if begin.date().isoformat() != local_date:
                continue
            kind = "activity" if component["type"] == "activity" else "travel"
            value = item(
                kind,
                begin.isoformat()[:19],
                finish.isoformat()[:19],
                str(component["type"]) + " — accepted estimated component",
                component,
            )
            value["startOffset"], value["endOffset"] = (
                begin.strftime("%z")[:3] + ":" + begin.strftime("%z")[3:],
                finish.strftime("%z")[:3] + ":" + finish.strftime("%z")[3:],
            )
            if kind == "travel":
                details = cast(dict[str, object], component.get("details", {}))
                mode = (
                    "flight"
                    if component["type"] == "flight"
                    else "rail" if component["type"] == "rail" else "transfer"
                )
                origin_name = str(details.get("originStation", "Departure location unavailable"))
                destination_name = str(
                    details.get("destinationStation", "Arrival location unavailable")
                )
                value["travelSegment"] = {
                    "mode": mode,
                    "origin": {
                        "placeId": str(component["id"]) + "-origin",
                        "name": origin_name,
                        "timezone": zone.key,
                        "location": None,
                    },
                    "destination": {
                        "placeId": str(component["id"]) + "-destination",
                        "name": destination_name,
                        "timezone": zone.key,
                        "location": None,
                    },
                    "plannedDeparture": begin.isoformat(),
                    "plannedArrival": finish.isoformat(),
                    "durationMinutes": max(1, int((finish - begin).total_seconds() / 60)),
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
                    "departureGuidance": "Planning defaults: arrive 180 minutes before "
                    "international flights, 120 domestic, 30 rail/ferry; "
                    "verify carrier requirements.",
                }
                # Reserve airport/station preparation before the exact accepted departure.
                padding = 180 if mode == "flight" else 30
                value["start"] = (begin - timedelta(minutes=padding)).isoformat()[:19]
                value["startOffset"] = (
                    (begin - timedelta(minutes=padding)).strftime("%z")[:3]
                    + ":"
                    + (begin - timedelta(minutes=padding)).strftime("%z")[3:]
                )
            items.append(value)
        # Fit everyday needs around accepted fixed components. Conflicts remain
        # visible; mandatory components are never silently moved or removed.
        blocks = [
            ("meal", "08:00", "08:45", "Morning meal"),
            ("meal", "18:00", "18:45", "Evening meal"),
            ("free_time", "15:00", "16:00", "Afternoon free time"),
        ]
        if not any(entry["type"] == "activity" for entry in items):
            title = (
                "Morning local discovery"
                if preferences.get("discovery", 50) >= 50
                else "Morning landmark visit"
            )
            title += (
                " in nature" if preferences.get("setting", 50) >= 67 else " around the destination"
            )
            blocks.append(
                ("activity", "10:00", "12:00" if preferences["pace"] <= 33 else "13:00", title)
            )
        for kind, begin_time, finish_time, title in blocks:
            begin, finish = local_date + "T" + begin_time, local_date + "T" + finish_time
            if any(str(entry["start"]) < finish and str(entry["end"]) > begin for entry in items):
                candidates = range(8 * 60, 21 * 60, 15)
                duration = 60 if kind == "free_time" else 45 if kind == "meal" else 120
                for minute in candidates:
                    begin = local_date + f"T{minute // 60:02}:{minute % 60:02}"
                    finish = (
                        local_date
                        + f"T{(minute + duration) // 60:02}:{(minute + duration) % 60:02}"
                    )
                    if not any(
                        str(entry["start"]) < finish and str(entry["end"]) > begin
                        for entry in items
                    ):
                        break
                else:
                    warnings.append(
                        f"Blocking: {local_date} has no room for {title}; "
                        "review mandatory travel and move lower-priority items."
                    )
                    continue
            items.append(item(kind, begin, finish, title))
        items.sort(key=lambda entry: str(entry["start"]))
        days.append(
            {
                "date": local_date,
                "destinationId": destination["id"],
                "timezone": zone.key,
                "paceAssessment": preferences["pace"],
                "items": items,
                "practicalNotes": [
                    "Morning, afternoon and evening plans include meals and free time; "
                    "preserve nine hours overnight rest.",
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
    return propose_trip_changes(
        request,
        [{"operation": "replace", "target": "/itineraryDays", "value": days}],
        "Build a day-by-day plan from the accepted route and exact component times. "
        "Preserve traveller choices; review lower-priority suggestions and all "
        "policy conflicts before finalization.",
        warnings,
    )
