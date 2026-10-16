import asyncio
import re
from datetime import date, timedelta
from typing import cast
from uuid import NAMESPACE_URL, uuid4, uuid5

from onholidai_agent.api.store import WebRunStore
from onholidai_agent.context.build import build_context
from onholidai_agent.graph.estimate import EstimateGraph, EstimateState, Sources, estimate
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.models.api import AgentResult, CreateAgentRunRequest
from onholidai_agent.tools.get_trip import TripReader, get_trip
from onholidai_agent.tools.propose_trip_changes import propose_trip_changes
from onholidai_agent.tools.retrieve_relevant_context import retrieve_relevant_context


def question(text: str, reason: str = "scope") -> AgentResult:
    return AgentResult.model_validate(
        {
            "kind": "clarification",
            "message": "A choice is needed before proposing changes.",
            "clarification": {"id": str(uuid4()), "question": text, "materialReason": reason},
        }
    )


def preserve_manual_destination_order(
    snapshot: dict[str, object],
    operations: list[dict[str, object]],
    message: str,
) -> list[dict[str, object]]:
    explicit_reorder = re.search(
        r"\b(?:re-?order|rearrang\w*|change\s+(?:the\s+)?(?:route|stop|destination)\s+order|"
        r"order\s+(?:the\s+)?(?:route|stops|destinations|cities)|put\s+.+?\s+(?:first|last|before|after))\b",
        message.casefold(),
    )
    if snapshot.get("destinationOrder", "manual") != "manual" or explicit_reorder:
        return operations
    current = snapshot.get("destinations")
    if not isinstance(current, list):
        return operations
    current_ids: list[str] = []
    for item in cast(list[object], current):
        if not isinstance(item, dict):
            continue
        destination_id = cast(dict[str, object], item).get("id")
        if isinstance(destination_id, str):
            current_ids.append(destination_id)
    positions = {destination_id: index for index, destination_id in enumerate(current_ids)}
    result: list[dict[str, object]] = []
    for operation in operations:
        value = operation.get("value")
        if operation.get("target") != "/destinations" or not isinstance(value, list):
            result.append(operation)
            continue
        value_items = cast(list[object], value)
        if operation.get("operation") == "reorder" and all(
            isinstance(destination_id, str) for destination_id in value_items
        ):
            requested = cast(list[str], value_items)
            selected = set(requested)
            preserved = [
                destination_id for destination_id in current_ids if destination_id in selected
            ]
            added = [
                destination_id for destination_id in requested if destination_id not in positions
            ]
            result.append({**operation, "value": [*preserved, *added]})
            continue
        if operation.get("operation") != "replace" or not all(
            isinstance(item, dict)
            and isinstance(cast(dict[str, object], item).get("id"), str)
            for item in value_items
        ):
            result.append(operation)
            continue
        entries = [cast(dict[str, object], item) for item in value_items]
        existing = sorted(
            (entry for entry in entries if cast(str, entry["id"]) in positions),
            key=lambda entry: positions[cast(str, entry["id"])],
        )
        added_entries = [entry for entry in entries if cast(str, entry["id"]) not in positions]
        ordered = [*existing, *added_entries]
        result.append({
            **operation,
            "value": [{**entry, "routePosition": index} for index, entry in enumerate(ordered)],
        })
    return result


async def refine(request: CreateAgentRunRequest, sources: TripReader) -> AgentResult:
    import langsmith
    from langgraph.graph import END, START, StateGraph  # pyright: ignore[reportMissingTypeStubs]

    async def compose(state: EstimateState) -> dict[str, AgentResult]:
        return {"result": await compose_refinement(state["request"], sources)}

    graph = cast(EstimateGraph, StateGraph(EstimateState))
    graph.add_node("refine", compose)
    graph.add_edge(START, "refine")
    graph.add_edge("refine", END)

    # Raw prompt/context must never become implicit LangGraph/LangSmith traces.
    with langsmith.tracing_context(enabled=False):  # pyright: ignore[reportUnknownMemberType]
        async with asyncio.timeout(30):
            result = await graph.compile().ainvoke({"request": request})
    value = result.get("result")
    if value is None:
        raise ValueError("missing_refinement_result")
    return value


async def compose_refinement(request: CreateAgentRunRequest, sources: TripReader) -> AgentResult:
    message = request.message.casefold().strip()
    if re.search(r"\b(book|reserve|cancel|reschedule|pay|payment)\b", message):
        return AgentResult.model_validate(
            {
                "kind": "answer",
                "message": (
                    "Use the separate transactional review UI for booking, payment, "
                    "cancellation or rescheduling. These actions are unavailable in the "
                    "planning release; this conversation cannot authorize them."
                ),
            }
        )
    trip = await get_trip(sources, request)
    context = build_context(request, trip)
    snapshot = cast(dict[str, object], trip["snapshot"])
    scheduled_edit = re.search(
        r"\b(remove|move) activity ([0-9a-f-]{36})(?: to (\d{4}-\d{2}-\d{2}) at (\d{2}:\d{2}))?",
        message,
    )
    if scheduled_edit:
        import copy
        from datetime import datetime

        days = copy.deepcopy(cast(list[dict[str, object]], snapshot.get("itineraryDays", [])))
        selected = None
        for day in days:
            for entry in cast(list[dict[str, object]], day["items"]):
                if entry["id"] == scheduled_edit.group(2) and entry["type"] == "activity":
                    selected = (day, entry)
        if selected is None:
            return question("Which scheduled activity should move or be removed?", "feasibility")
        source_day, entry = selected
        if entry.get("componentId"):
            return question(
                "This activity has supplier terms. Review a fresh offer before changing its time.",
                "feasibility",
            )
        source_items = cast(list[dict[str, object]], source_day["items"])
        if scheduled_edit.group(1) == "move":
            target_day = next((day for day in days if day["date"] == scheduled_edit.group(3)), None)
            if (
                not target_day
                or not scheduled_edit.group(4)
                or target_day["timezone"] != source_day["timezone"]
            ):
                return question(
                    "Which itinerary date/time in the same timezone should I use?", "feasibility"
                )
            try:
                start = datetime.fromisoformat(str(entry["start"]))
                end = datetime.fromisoformat(str(entry["end"]))
                moved = datetime.fromisoformat(
                    scheduled_edit.group(3) + "T" + scheduled_edit.group(4)
                )
            except ValueError:
                return question("Which valid date and local time should I use?", "feasibility")
            source_items.remove(entry)
            entry["start"], entry["end"] = moved.isoformat(), (moved + (end - start)).isoformat()
            entry.pop("startOffset", None)
            entry.pop("endOffset", None)
            entry["verificationStatus"], entry["constraintEvidence"] = "unverified", []
            target_items = cast(list[dict[str, object]], target_day["items"])
            target_items.append(entry)
            target_items.sort(key=lambda item: str(item["start"]))
        else:
            source_items.remove(entry)
        return propose_trip_changes(
            request,
            [{"operation": "replace", "target": "/itineraryDays", "value": days}],
            "Review the requested lower-priority activity change. Supplier terms and prices "
            "are unchanged; feasibility is checked again before finalization.",
            [],
        )
    destinations = cast(list[dict[str, object]], snapshot["destinations"])
    matches = [entry for entry in destinations if str(entry["name"]).casefold() in message]
    operations: list[dict[str, object]] = []
    warnings = [
        "Web recomputes affected planning offers and prices before review; no state has changed."
    ]
    rationale = ""
    numbers = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
    nights = re.search(
        r"\b(?:add|extend|extra|another)\s+(\d+|one|two|three|four|five)\s+(?:extra\s+)?(?:days?|nights?)\b",
        message,
    )
    if (
        "rejected" in message
        and isinstance(sources, EstimateSources)
        and isinstance(sources.store, WebRunStore)
    ):
        historical = await retrieve_relevant_context(
            sources.store,
            request,
            {
                "query": "rejected",
                "reason": "Resolve the traveller's reference to a rejected destination",
                "limit": 20,
            },
        )
        items = cast(list[dict[str, object]], historical.get("items", []))
        current_ids = {entry["id"] for entry in destinations}
        candidates: dict[str, dict[str, object]] = {}
        for item in items:
            for entry in cast(list[dict[str, object]], item.get("destinations", [])):
                if entry.get("id") not in current_ids:
                    candidates[str(entry["id"])] = entry
        if len(candidates) != 1:
            return question("Which previously rejected destination do you want to use?")
        restored = next(iter(candidates.values()))
        routed = [
            {
                **entry,
                "arrivalDate": None,
                "departureDate": None,
                "plannedNights": 0,
                "routePosition": index,
            }
            for index, entry in enumerate([*destinations, restored])
        ]
        operations.append({"operation": "replace", "target": "/destinations", "value": routed})
        rationale = (
            f"Reconsider {restored['name']} from the scoped rejected proposal. "
            "Current constraints remain authoritative; dates and prices are recomputed "
            "before acceptance."
        )
    elif nights:
        if len(matches) != 1:
            return question("Which destination should receive the extra nights?")
        value = nights.group(1)
        extra = numbers[value] if value in numbers else int(value)
        if not 1 <= extra <= 30:
            return question(
                "How many extra nights, between one and thirty, do you want?", "feasibility"
            )
        routed = [dict(entry) for entry in destinations]
        selected = destinations.index(matches[0])
        if not isinstance(routed[selected].get("departureDate"), str):
            return question("Which dates should the extra nights follow?", "feasibility")
        for index in range(selected, len(routed)):
            entry = routed[index]
            departure = entry.get("departureDate")
            arrival = entry.get("arrivalDate")
            if not isinstance(departure, str) or not isinstance(arrival, str):
                return question("Which dates should the revised route use?", "feasibility")
            entry["departureDate"] = (
                date.fromisoformat(departure) + timedelta(days=extra)
            ).isoformat()
            if index == selected:
                entry["plannedNights"] = cast(int, entry["plannedNights"]) + extra
            else:
                entry["arrivalDate"] = (
                    date.fromisoformat(arrival) + timedelta(days=extra)
                ).isoformat()
        operations.append({"operation": "replace", "target": "/destinations", "value": routed})
        duration = cast(dict[str, int], snapshot["duration"])
        actual = sum(cast(int, entry["plannedNights"]) for entry in routed) + 1
        if actual > duration["maximumDays"]:
            return question(
                "May I extend your maximum duration to fit the extra nights? "
                "Update the duration limit in trip details before retrying.",
                "feasibility",
            )
        rationale = (
            f"Add {extra} nights in {matches[0]['name']}; later stops and return travel "
            f"move by {extra} days. Existing duration limits and availability windows "
            "remain unchanged."
        )
    elif re.search(r"\b(?:set|change)\s+(?:the\s+)?ideal duration\s+to\s+(\d+)\s+days?", message):
        match = re.search(r"ideal duration\s+to\s+(\d+)", message)
        assert match is not None
        days = int(match.group(1))
        duration = cast(dict[str, int], snapshot["duration"])
        if not duration["minimumDays"] <= days <= duration["maximumDays"]:
            return question(
                "Which ideal duration within your current minimum and maximum should I use?",
                "feasibility",
            )
        operations.append({"operation": "replace", "target": "/duration/idealDays", "value": days})
        rationale = (
            f"Set the ideal duration to {days} days and redistribute nights; "
            "refresh transport, stays and activities."
        )
    elif re.search(
        r"\b(?:set|change)\s+(?:the\s+)?(?:party|travellers?)\s+to\s+(\d+)\s+adults?", message
    ):
        match = re.search(r"to\s+(\d+)\s+adults?", message)
        assert match is not None
        adults = int(match.group(1))
        operations.append(
            {"operation": "replace", "target": "/travellerParty/adults", "value": adults}
        )
        rationale = (
            f"Set the party to {adults} adults; web rechecks occupancy, "
            "eligibility and all customer prices."
        )
    elif re.search(r"\bset\s+(pace|spend|discovery|independence|setting)\s+to\s+(\d+)\b", message):
        match = re.search(
            r"set\s+(pace|spend|discovery|independence|setting)\s+to\s+(\d+)", message
        )
        assert match is not None
        operations.append(
            {
                "operation": "replace",
                "target": "/preferences/" + match.group(1),
                "value": int(match.group(2)),
            }
        )
        display_value = round(1 + int(match.group(2)) * 0.09, 2)
        rationale = (
            f"Set {match.group(1)} to {display_value:g}/10, preserving hard "
            "requirements and refreshing affected recommendations."
        )
    elif re.search(
        r"\badd a required (schedule|dietary|lodging|transport|other) constraint:\s*", message
    ):
        match = re.search(
            r"add a required (schedule|dietary|lodging|transport|other) constraint:\s*(.+)",
            request.message,
            re.IGNORECASE,
        )
        assert match is not None
        statement = match.group(2).strip()
        operations.append(
            {
                "operation": "add",
                "target": "/constraints/-",
                "value": {
                    "id": str(uuid5(NAMESPACE_URL, request.request_id + statement)),
                    "category": match.group(1).casefold(),
                    "statement": statement,
                    "priority": "required",
                    "source": {"kind": "conversation_message", "referenceId": request.request_id},
                    "status": "unverified",
                    "confirmedByUser": True,
                },
            }
        )
        rationale = (
            "Record the traveller's explicit non-negotiable requirement and "
            "refresh planning recommendations. Source verification is still required."
        )
    elif re.search(r"\bremove\b", message):
        if len(matches) != 1 or len(destinations) <= 1:
            return question("Which destination should be removed while keeping at least one stop?")
        routed = [
            {**entry, "routePosition": index}
            for index, entry in enumerate(
                entry for entry in destinations if entry is not matches[0]
            )
        ]
        # Clear old date allocation so web reallocates the existing ideal duration.
        routed = [
            {**entry, "arrivalDate": None, "departureDate": None, "plannedNights": 0}
            for entry in routed
        ]
        operations.append({"operation": "replace", "target": "/destinations", "value": routed})
        rationale = (
            f"Remove {matches[0]['name']} and redistribute the existing trip duration "
            "among the remaining stops."
        )
    elif re.search(r"\b(slower|relaxed|faster|packed)\b", message):
        operations.append(
            {
                "operation": "replace",
                "target": "/preferences/pace",
                "value": 25 if re.search(r"\b(slower|relaxed)\b", message) else 75,
            }
        )
        rationale = "Adjust the pace preference and refresh activity and transport recommendations."
    elif re.search(r"\b(cheaper|budget|luxury)\b", message):
        operations.append(
            {
                "operation": "replace",
                "target": "/preferences/spend",
                "value": 75 if "luxury" in message else 25,
            }
        )
        rationale = (
            "Compare read-only planning offers at the requested spend level while "
            "preserving hard constraints. Savings are shown only if repricing supports them."
        )
    else:
        if isinstance(sources, EstimateSources):
            # Token Factory supplies a typed advisory proposal; only the closed operation
            # schema can pass, and web independently validates/reprices before review.
            import json

            advice = await sources.model.complete(
                [
                    context[0],
                    {
                        "role": "system",
                        "content": (
                            "Return JSON only with keys operations (1-32 allowlisted draft "
                            "JSON patch operations), rationale, warnings. Never change prices "
                            'or booking state. If ambiguous return {"question":"one focused '
                            'question"}. Current trip facts override history.'
                        ),
                    },
                    context[1],
                ]
            )
            try:
                parsed = json.loads(advice)
                if not isinstance(parsed, dict):
                    raise ValueError("invalid_refinement")
                data = cast(dict[str, object], parsed)
                if isinstance(data.get("question"), str):
                    return question(cast(str, data["question"])[:1000])
                operations = cast(list[dict[str, object]], data["operations"])
                rationale = str(data["rationale"])[:4000]
            except (ValueError, KeyError, TypeError):
                return question("Which destination, dates, travellers or preference should change?")
        else:
            return question("Which destination, dates, travellers or preference should change?")
    if "mornings free" in message or "no early mornings" in message:
        constraints = cast(list[dict[str, object]], snapshot.get("constraints", []))
        if not any(
            "morning" in str(entry.get("statement", "")).casefold() for entry in constraints
        ):
            operations.append(
                {
                    "operation": "add",
                    "target": "/constraints/-",
                    "value": {
                        "id": str(uuid4()),
                        "category": "schedule",
                        "statement": "Keep mornings free; no activities before 10:00",
                        "priority": "required",
                        "source": {
                            "kind": "conversation_message",
                            "referenceId": request.request_id,
                        },
                        "status": "unverified",
                        "confirmedByUser": True,
                    },
                }
            )
    operations = preserve_manual_destination_order(snapshot, operations, message)
    return propose_trip_changes(request, operations, rationale, warnings)


async def dispatch(request: CreateAgentRunRequest, sources: Sources) -> AgentResult:
    if re.match(
        r"^(what|why|how|which|tell me|compare|suggest|explain|can i)\b",
        request.message.casefold().strip(),
    ):
        trip = await get_trip(sources, request)
        context = build_context(request, trip)
        if isinstance(sources, EstimateSources):
            answer = await sources.model.complete(
                [
                    context[0],
                    {
                        "role": "system",
                        "content": (
                            "Answer the traveller's question in plain language. Offer two useful "
                            "options when appropriate. Distinguish verified trip facts from ideas. "
                            "Do not propose operations or claim changes, reservations or payments. "
                            "A later explicit request can create a reviewable trip proposal."
                        ),
                    },
                    context[1],
                ]
            )
        else:
            snapshot = cast(dict[str, object], trip["snapshot"])
            places = cast(list[dict[str, object]], snapshot.get("destinations", []))
            route = ", ".join(str(place.get("name", "")) for place in places)
            answer = (
                f"Your saved route includes {route}. You could keep the current route and "
                "explore its daily plans, or ask me to propose a change to the pace, dates or "
                "stays. Tell me which option you prefer; changes require your review. "
                "Transport, activities and prices remain subject to verification."
            )
        return AgentResult.model_validate({"kind": "answer", "message": answer[:12000]})
    if request.purpose == "initial_estimate":
        return await estimate(request, sources)
    if request.purpose == "refinement":
        return await refine(request, sources)
    if request.purpose == "finalization":
        from onholidai_agent.graph.finalize import finalize

        return await finalize(request, sources)
    raise ValueError("unsupported_purpose")
