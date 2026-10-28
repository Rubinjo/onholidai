"""Adds a named supplier activity to the itinerary from the trip's own facts.

A traveller who names an activity already told us the only facts the planning graph
needs: the destination and the kind of experience. This module reads the remaining
scope (stay dates, existing day plans, recorded constraints) from the trip instead of
asking, searches the supplier catalogue for that destination, and proposes the
resulting day-plan change.
"""

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, cast
from uuid import NAMESPACE_URL, uuid4, uuid5
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from onholidai_agent.graph.finalize import build_itinerary_days
from onholidai_agent.models.api import AgentResult, CreateAgentRunRequest
from onholidai_agent.tools.propose_trip_changes import propose_trip_changes

# Only explicit "put this experience in my trip" wording may reach the catalogue.
# Booking, paying or cancelling stays with the transactional review flow.
ADD_VERBS = r"(?:add|include|schedule|fit\s+in|slot\s+in|insert|arrange)"
ACTIVITY_NOUNS = (
    r"(?:activit(?:y|ies)|show|shows|tour|tours|experience|experiences|performance|"
    r"concert|museum|exhibition|cruise|class|classes|workshop|ceremony|tasting|tickets?)"
)
# A request that also changes dates, duration or settings is handled by those rules.
SETTING_WORDS = re.compile(
    r"\b(?:nights?|duration|constraint|pace|spend|budget|adults?|travellers?|"
    r"preferences?|settings?)\b",
    re.I,
)
STOPWORDS = frozenset(
    {
        "the",
        "and",
        "for",
        "with",
        "from",
        "into",
        "our",
        "my",
        "a",
        "an",
        "of",
        "in",
        "at",
        "on",
        "to",
        "plus",
    }
)
# A clear match shares every requested word; a weaker candidate becomes a focused
# choice between cited options instead of a guessed booking.
CLEAR_MATCH = 0.95
CLOSEST_MATCH = 0.4
DEFAULT_DURATION_MINUTES = 120
MAXIMUM_DURATION_MINUTES = 480


class ActivityCatalogue(Protocol):
    async def activity_search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]: ...


@dataclass(frozen=True, slots=True)
class ActivityIntent:
    name: str
    message: str


@dataclass(frozen=True, slots=True)
class RankedOffer:
    score: float
    title: str
    offer: dict[str, object]
    located: bool


def activity_intent(message: str) -> ActivityIntent | None:
    """Reads a request to add one named activity to the trip.

    Anything that also changes dates, duration or planning settings belongs to those
    deterministic rules, so it is deliberately not treated as an activity request.
    """
    text = message.strip()
    if SETTING_WORDS.search(text):
        return None
    if not re.search(rf"\b{ADD_VERBS}\b", text, re.I):
        return None
    if not re.search(rf"\b{ACTIVITY_NOUNS}\b", text, re.I):
        return None
    prefix = rf"^[\s\W]*(?:(?:please|can you|could you|i'd like to)\s+)?{ADD_VERBS}\s+"
    name = re.sub(prefix, "", text, flags=re.I)
    name = re.split(
        r"\s+(?:to|into|in|for|during)\s+(?:my|our|the)\s+"
        r"(?:stay|trip|itinerary|plan|visit|days?|schedule)\b",
        name,
        maxsplit=1,
        flags=re.I,
    )[0]
    name = re.split(r"\s+(?:to|in|at|near|on\s+day)\s+", name, maxsplit=1)[0]
    name = re.sub(
        r"\s+(?:activit(?:y|ies)|experience|option|options|please)\s*[.!?]*$",
        "",
        name,
        count=1,
        flags=re.I,
    )
    name = re.sub(r"^(?:a|an|the)\s+", "", name.strip(), flags=re.I).strip(" .,!?:;")
    if len(name) < 3:
        return None
    return ActivityIntent(name=name, message=text)


def select_destination(
    snapshot: dict[str, object], intent: ActivityIntent
) -> tuple[dict[str, object] | None, str | None]:
    """Returns the named stop, or ``None`` plus one question when the scope is unclear."""
    destinations = cast(list[dict[str, object]], snapshot.get("destinations", []))
    lowered = intent.message.casefold()
    named = [
        entry
        for entry in destinations
        if str(entry.get("name", "")).strip() and str(entry["name"]).casefold() in lowered
    ]
    if len(named) == 1:
        return named[0], None
    if len(destinations) == 1:
        return destinations[0], None
    if not destinations:
        return None, None
    return None, (
        f"Which stop should {intent.name} be added to: "
        + ", ".join(str(entry.get("name")) for entry in destinations)
        + "?"
    )


def _terms(value: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-z0-9]+", value.casefold())
        if len(token) > 2 and token not in STOPWORDS
    ]


def _normalized(value: str) -> str:
    return value.casefold()


def rank_offers(
    offers: list[dict[str, object]], intent: ActivityIntent, destination_name: str | None = None
) -> list[RankedOffer]:
    wanted = set(_terms(intent.name))
    if not wanted:
        return []
    located_name = _normalized(destination_name) if destination_name else None
    ranked: list[RankedOffer] = []
    for offer in offers:
        component = cast(dict[str, object], offer.get("component", {}))
        planning = cast(dict[str, object], component.get("planningDetails") or {})
        title = planning.get("locationName")
        if not isinstance(title, str) or not title.strip():
            continue
        found = set(_terms(title))
        score = len(wanted & found) / len(wanted)
        if score <= 0:
            continue
        located = bool(located_name) and located_name in _normalized(title)
        ranked.append(RankedOffer(score=score, title=title.strip(), offer=offer, located=located))
    # A stop-located listing wins before a text-only match. Equal matches keep the
    # supplier's own relevance order instead of inventing a commercial tie-break.
    ranked.sort(key=lambda entry: (not entry.located, -entry.score))
    return ranked


def offer_duration(offer: dict[str, object]) -> int:
    component = cast(dict[str, object], offer.get("component", {}))
    planning = cast(dict[str, object], component.get("planningDetails") or {})
    duration = planning.get("durationMinutes")
    if isinstance(duration, int) and 0 < duration <= MAXIMUM_DURATION_MINUTES:
        return duration
    return DEFAULT_DURATION_MINUTES


def _earliest_minute(snapshot: dict[str, object]) -> int:
    constraints = cast(list[dict[str, object]], snapshot.get("constraints", []))
    for constraint in constraints:
        statement = str(constraint.get("statement", "")).casefold()
        if constraint.get("status") == "removed" or constraint.get("priority") != "required":
            continue
        if "morning" in statement and (
            "free" in statement or "no early" in statement or "after 10" in statement
        ):
            return 10 * 60
    return 8 * 60


def _minutes(value: object) -> int | None:
    text = str(value)[11:16]
    if not re.fullmatch(r"\d{2}:\d{2}", text):
        return None
    return int(text[:2]) * 60 + int(text[3:])


def _free_start(day: dict[str, object], duration: int, earliest: int, target: int) -> int | None:
    occupied = [
        (begin, end)
        for item in cast(list[dict[str, object]], day.get("items", []))
        if (begin := _minutes(item.get("start"))) is not None
        and (end := _minutes(item.get("end"))) is not None
    ]
    latest = 21 * 60 - duration
    available = [
        minute
        for minute in range(earliest, latest + 1, 15)
        if all(minute + duration <= begin or minute >= end for begin, end in occupied)
    ]
    if not available:
        return None
    return min(available, key=lambda minute: (abs(minute - target), minute))


def _placeholder_ids(day: dict[str, object]) -> list[str]:
    """Generic day-plan suggestions the traveller's named activity supersedes."""
    return [
        str(item.get("id"))
        for item in cast(list[dict[str, object]], day.get("items", []))
        if item.get("type") in ("activity", "free_time")
        and item.get("componentId") is None
        and item.get("priority") == "preference"
    ]


def _slot(
    day: dict[str, object], duration: int, earliest: int, target: int
) -> tuple[int, list[str]] | None:
    start = _free_start(day, duration, earliest, target)
    if start is not None:
        return start, []
    placeholders = set(_placeholder_ids(day))
    if not placeholders:
        return None
    items = [
        item
        for item in cast(list[dict[str, object]], day.get("items", []))
        if str(item.get("id")) not in placeholders
    ]
    start = _free_start({**day, "items": items}, duration, earliest, target)
    return None if start is None else (start, sorted(placeholders))


def _offset(zone: ZoneInfo, day: str, minute: int) -> str:
    moment = datetime.fromisoformat(f"{day}T{_clock(minute)}").replace(tzinfo=zone)
    return moment.strftime("%z")[:3] + ":" + moment.strftime("%z")[3:]


def _clock(minute: int) -> str:
    return f"{minute // 60:02}:{minute % 60:02}"


def activity_item(
    request: CreateAgentRunRequest,
    destination: dict[str, object],
    day: str,
    title: str,
    duration: int,
    start_minute: int,
    notes: list[str],
) -> dict[str, object]:
    zone_name = str(destination.get("timezone", "UTC"))
    try:
        zone = ZoneInfo(zone_name)
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    end_minute = start_minute + duration
    item: dict[str, object] = {
        "id": str(uuid5(NAMESPACE_URL, request.request_id + day + "activity" + title)),
        "type": "activity",
        "title": title[:200],
        "start": f"{day}T{_clock(start_minute)}:00",
        "end": f"{day}T{_clock(end_minute)}:00",
        "startOffset": _offset(zone, day, start_minute),
        "endOffset": _offset(zone, day, end_minute),
        "location": destination.get("location"),
        "componentId": None,
        "constraintChecks": [],
        "constraintEvidence": [],
        "status": "planned",
        "travelSegment": None,
        "priority": "strong",
        "verificationStatus": "unverified",
        "timingEvidence": [],
        "durationUpperBoundMinutes": None,
        "feasibilityPolicyVersion": "1",
        "practicalNotes": notes[:16],
    }
    return item


def _candidate_days(
    days: list[dict[str, object]], destination: dict[str, object]
) -> list[dict[str, object]]:
    days = [day for day in days if day.get("destinationId") == destination.get("id")]

    # A day that already carries a long journey has no room for an added experience, so
    # it sorts last; otherwise the lightest fixed plan wins and travel days stay free.
    def load(day: dict[str, object]) -> tuple[bool, int, int, str]:
        items = cast(list[dict[str, object]], day.get("items", []))
        travelling = any(
            item.get("type") == "travel"
            and (end := _minutes(item.get("end"))) is not None
            and (begin := _minutes(item.get("start"))) is not None
            and end - begin >= 180
            for item in items
        )
        fixed = sum(1 for item in items if item.get("type") == "activity")
        return travelling, fixed, len(items), str(day.get("date", ""))

    return sorted(days, key=load)


def _target_minute(intent: ActivityIntent) -> int:
    """Suggests the part of day the requested experience usually runs in."""
    if re.search(
        r"\b(?:show|performance|concert|dinner|night|evening|ceremony)\b", intent.name, re.I
    ):
        return 19 * 60
    return 10 * 60


def _within_stay(snapshot: dict[str, object], destination: dict[str, object], day: str) -> bool:
    windows = cast(list[dict[str, object]], snapshot.get("availabilityWindows", []))
    if windows and not any(
        str(window.get("startDate", "")) <= day <= str(window.get("endDate", ""))
        for window in windows
    ):
        return False
    arrival = destination.get("arrivalDate")
    departure = destination.get("departureDate")
    if isinstance(arrival, str) and day < arrival:
        return False
    return not (isinstance(departure, str) and day > departure)


def _notes(offer: dict[str, object] | None, title: str) -> list[str]:
    notes = [
        f"{title} is a supplier-listed activity; verify its exact start time, ticket "
        "terms and accessibility before booking.",
    ]
    if offer is not None:
        component = cast(dict[str, object], offer.get("component", {}))
        planning = cast(dict[str, object], component.get("planningDetails") or {})
        source = planning.get("source") or component.get("provider")
        product = component.get("supplierOfferId")
        attribution = ", ".join(
            str(value) for value in (source, product) if isinstance(value, str) and value
        )
        if attribution:
            notes.append(f"Sourced from {attribution} (unverified catalogue listing).")
        notes.append(
            "The supplier publishes no party price or dated availability for this "
            "listing, so it does not change the estimated trip total."
        )
    return notes


def _proposal(
    request: CreateAgentRunRequest,
    days: list[dict[str, object]],
    destination: dict[str, object],
    day: str,
    title: str,
    offer: dict[str, object] | None,
    duration: int,
    start_minute: int,
    replaced: list[str],
) -> AgentResult:
    updated = [dict(entry) for entry in days]
    selected = next(entry for entry in updated if entry.get("date") == day)
    items = [
        dict(item)
        for item in cast(list[dict[str, object]], selected.get("items", []))
        if str(item.get("id")) not in set(replaced)
    ]
    notes = _notes(offer, title)
    items.append(activity_item(request, destination, day, title, duration, start_minute, notes))
    items.sort(key=lambda entry: str(entry.get("start", "")))
    selected["items"] = items
    warnings = [
        "Daily planning only: times, meeting points and ticket availability remain "
        "unverified until the supplier confirms them.",
        "The estimated trip total is unchanged because this supplier published no "
        "dated party price for the listing.",
    ]
    if replaced:
        warnings.insert(
            0,
            "The requested activity replaces a lower-priority day-plan suggestion on "
            f"{day}; no accepted supplier component or requirement was changed.",
        )
    return propose_trip_changes(
        request,
        [{"operation": "replace", "target": "/itineraryDays", "value": updated}],
        (
            f"Add {title} to {destination.get('name')} on {day} at {_clock(start_minute)}, "
            f"using the trip's own destination, dates and remaining free time. "
            "No inventory is reserved and the estimated total is unchanged."
        ),
        warnings,
    )


def _planned_activity(
    snapshot: dict[str, object], destination: dict[str, object], intent: ActivityIntent
) -> tuple[str, dict[str, object]] | None:
    """Finds an equivalent activity already planned at this stop.

    Repeating the same request must never duplicate a day-plan item; the traveller can
    still ask to move or remove the planned one explicitly.
    """
    wanted = set(_terms(intent.name))
    if not wanted:
        return None
    days = cast(list[dict[str, object]], snapshot.get("itineraryDays", []))
    for day in sorted(days, key=lambda entry: str(entry.get("date", ""))):
        if day.get("destinationId") != destination.get("id"):
            continue
        for item in cast(list[dict[str, object]], day.get("items", [])):
            if item.get("type") != "activity":
                continue
            title = str(item.get("title") or "")
            if wanted <= set(_terms(title)):
                return str(day.get("date", "")), item
    return None


async def add_activity(
    request: CreateAgentRunRequest,
    sources: object,
    snapshot: dict[str, object],
    intent: ActivityIntent,
) -> AgentResult:
    destination, ambiguity = select_destination(snapshot, intent)
    if ambiguity:
        return _clarification(ambiguity)
    if destination is None:
        return _clarification(
            f"Which stop should {intent.name} be added to? Reply with the destination name."
        )
    planned = _planned_activity(snapshot, destination, intent)
    if planned is not None:
        day, item = planned
        return _answer(
            f"{item.get('title')} is already planned in {destination.get('name')} on {day} "
            f"from {str(item.get('start', ''))[11:16]} to {str(item.get('end', ''))[11:16]}. "
            "Nothing changed; ask me to move or remove that activity if you want a different "
            "day or time."
        )
    if not hasattr(sources, "activity_search"):
        return _answer(
            f"Supplier activity search is unavailable in this environment, so "
            f"{intent.name} was not added and nothing changed."
        )
    arrival = destination.get("arrivalDate")
    departure = destination.get("departureDate")
    if not isinstance(arrival, str) or not isinstance(departure, str):
        return _clarification(
            f"Which dates should {intent.name} in {destination.get('name')} use?", "feasibility"
        )
    query: dict[str, object] = {
        "componentTypes": ["activity"],
        "destinationIds": [destination["id"]],
        "startDate": arrival,
        "endDate": departure,
        "query": intent.name,
    }
    try:
        found = await cast(ActivityCatalogue, sources).activity_search(request, query)
    except Exception:
        # A catalogue failure is answered, not turned into an unanswerable question.
        return _answer(
            f"I could not reach the activity catalogue for {destination.get('name')} just "
            f"now, so {intent.name} was not added and nothing changed. Retry the request once "
            "the supplier connection is available."
        )
    offers: list[dict[str, object]] = []
    for raw in cast(list[object], found.get("offers", [])):
        if not isinstance(raw, dict):
            continue
        offer = cast(dict[str, object], raw)
        component = cast(dict[str, object], offer.get("component", {}))
        if component.get("type") == "activity":
            offers.append(offer)
    ranked = rank_offers(offers, intent, str(destination.get("name") or "") or None)
    if not ranked:
        researched = _researched(found)
        return _answer(
            f"I searched supplier activities for {destination.get('name')} "
            f"({arrival} to {departure}) and found no listing for {intent.name}. "
            f"{researched}Nothing was added to the itinerary."
        )
    best = ranked[0]
    close = [
        entry
        for entry in ranked[1:]
        if entry.score >= best.score - 0.15 and entry.located == best.located
    ]
    if best.score < CLEAR_MATCH and close:
        options = [best, *close][:3]
        return _clarification(
            f"Which sourced {destination.get('name')} activity should I add: "
            + "; ".join(entry.title for entry in options)
            + "?"
        )
    if best.score < CLOSEST_MATCH:
        researched = _researched(found)
        return _answer(
            f"I searched supplier activities for {destination.get('name')} "
            f"({arrival} to {departure}) and the closest listing was {best.title}, which is "
            f"not {intent.name}. {researched}Nothing was added to the itinerary."
        )
    duration = offer_duration(best.offer)
    earliest = _earliest_minute(snapshot)
    target = _target_minute(intent)
    days = [
        dict(entry) for entry in cast(list[dict[str, object]], snapshot.get("itineraryDays", []))
    ]
    if not days:
        planned = build_itinerary_days(snapshot, request.message, request.request_id)
        if isinstance(planned, str):
            return _clarification(planned, "feasibility")
        days = [dict(entry) for entry in planned[0]]
    slots: list[tuple[dict[str, object], str, int, list[str]]] = []
    for day in _candidate_days(days, destination):
        day_date = str(day.get("date", ""))
        if not day_date or not _within_stay(snapshot, destination, day_date):
            continue
        slot = _slot(day, duration, earliest, target)
        if slot is not None:
            slots.append((day, day_date, slot[0], slot[1]))
    if not slots:
        return _clarification(
            f"Which day of your {destination.get('name')} stay should {best.title} use? "
            "The planned days have no free "
            f"{duration}-minute slot.",
            "feasibility",
        )
    _day, day_date, start, replaced = slots[0]
    return _proposal(
        request, days, destination, day_date, best.title, best.offer, duration, start, replaced
    )


def _researched(found: dict[str, object]) -> str:
    outcomes = found.get("outcomes")
    if not isinstance(outcomes, list):
        return ""
    labels: list[str] = []
    for outcome in cast(list[object], outcomes)[:4]:
        if not isinstance(outcome, dict):
            continue
        entry = cast(dict[str, object], outcome)
        if entry.get("componentType") != "activity":
            continue
        status = entry.get("status")
        if isinstance(status, str) and status not in ("available", "no_matches"):
            labels.append(status.replace("_", " "))
    return f"The supplier reported {', '.join(labels)}. " if labels else ""


def _clarification(text: str, reason: str = "scope") -> AgentResult:
    return AgentResult.model_validate(
        {
            "kind": "clarification",
            "message": "A choice is needed before proposing changes.",
            "clarification": {"id": str(uuid4()), "question": text, "materialReason": reason},
        }
    )


def _answer(text: str) -> AgentResult:
    return AgentResult.model_validate({"kind": "answer", "message": text})
