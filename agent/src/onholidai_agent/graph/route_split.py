"""Resolve a night-by-night route split from a message and the saved itinerary.

Travellers usually state nights only for the stops they care about. Everything they
leave out is already decided by the saved plan, so it is inferred rather than asked.
A question is only produced when the stated nights cannot be reconciled with a stop
that still needs a night, with the recorded duration window, or with saved dates.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

NUMBER_WORDS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
}
# "4 nights in Tokyo", "four more nights at the Kyoto hotel", "Tokyo for 2 nights".
NIGHTS_PATTERN = re.compile(
    r"\b(?P<count>\d{1,2}|" + "|".join(NUMBER_WORDS) + r")\s+(?:more\s+|extra\s+)?nights?\b"
)
CLAUSE_SEPARATOR = re.compile(r"[,;]|\band\b|\bthen\b|\bplus\b|\bwith\b|\balso\b")

Destination = dict[str, object]


@dataclass(frozen=True)
class RouteSplit:
    """A dated route that materialises the requested split."""

    destinations: list[Destination]
    nights: list[tuple[str, int]]
    start: date
    end: date
    previous_nights: int


@dataclass(frozen=True)
class SplitQuestion:
    """One focused question for a split that conflicts with a recorded constraint."""

    text: str
    reason: str = "feasibility"


def _as_int(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return 0


def _nights(destination: Destination) -> int:
    return max(0, _as_int(destination.get("plannedNights")))


def _name_keys(destination: Destination) -> set[str]:
    """Name spellings the message may use for one stop."""
    name = str(destination.get("name", "")).strip().casefold()
    if not name:
        return set()
    keys = {name}
    # "Tokyo, Japan" and "Tokyo (Japan)" are the same stop as "Tokyo".
    primary = re.split(r"[,(\u2013\u2014]|\s-\s", name, maxsplit=1)[0].strip()
    if primary:
        keys.add(primary)
    return {key for key in keys if len(key) >= 3}


def _mentions(clause: str, key: str) -> bool:
    return re.search(rf"(?<![a-z0-9]){re.escape(key)}(?![a-z0-9])", clause) is not None


def stated_nights(message: str, destinations: list[Destination]) -> dict[str, int]:
    """Nights the message states per stop, keyed by destination id.

    A clause with one stop and one night count binds them, whichever order they
    appear in. A clause naming more than one stop or no count states nothing, so
    that stop keeps the plan already saved for it.
    """
    keys = [(str(place.get("id", "")), _name_keys(place)) for place in destinations]
    stated: dict[str, int] = {}
    for clause in CLAUSE_SEPARATOR.split(message.casefold()):
        match = NIGHTS_PATTERN.search(clause)
        if match is None:
            continue
        named = [
            destination_id
            for destination_id, names in keys
            if any(_mentions(clause, name) for name in names)
        ]
        if len(named) != 1:
            continue
        raw = match.group("count")
        stated[named[0]] = int(raw) if raw.isdigit() else NUMBER_WORDS[raw]
    return stated


def _current_nights(destinations: list[Destination], duration: dict[str, object]) -> int:
    """Nights the saved plan already covers, even when its route is still undated."""
    if destinations and all(_nights(place) > 0 for place in destinations):
        return sum(_nights(place) for place in destinations)
    return max(0, _as_int(duration.get("idealDays")) - 1)


def _window_bounds(window: dict[str, object]) -> tuple[date, date] | None:
    start, end = window.get("startDate"), window.get("endDate")
    if not isinstance(start, str) or not isinstance(end, str):
        return None
    return date.fromisoformat(start), date.fromisoformat(end)


def _window_covers(windows: list[dict[str, object]], start: date, end: date) -> bool:
    return any(
        bounds[0] <= start and bounds[1] >= end
        for bounds in (_window_bounds(window) for window in windows)
        if bounds
    )


def _route_start(
    destinations: list[Destination], windows: list[dict[str, object]], span_days: int
) -> date | None:
    """Keep the saved departure date, or date an undated route inside a saved window."""
    arrivals = [place.get("arrivalDate") for place in destinations]
    if arrivals and all(isinstance(arrival, str) for arrival in arrivals):
        return date.fromisoformat(str(arrivals[0]))
    usable = [
        (window, bounds)
        for window in windows
        if (bounds := _window_bounds(window)) and (bounds[1] - bounds[0]).days + 1 >= span_days
    ]
    preferred = [bounds[0] for window, bounds in usable if window.get("preference") == "preferred"]
    return (preferred or [bounds[0] for _, bounds in usable] or [None])[0]


def _saved_nights(destinations: list[Destination]) -> list[tuple[date, date]] | None:
    spans: list[tuple[date, date]] = []
    for place in destinations:
        arrival, departure = place.get("arrivalDate"), place.get("departureDate")
        if not isinstance(arrival, str) or not isinstance(departure, str):
            return None
        spans.append((date.fromisoformat(arrival), date.fromisoformat(departure)))
    return spans


def plan_route_split(
    message: str,
    destinations: list[Destination],
    duration: dict[str, object],
    windows: list[dict[str, object]] | None = None,
) -> RouteSplit | SplitQuestion | None:
    """Build the dated route the message asks for, or explain why it cannot be built."""
    stated = stated_nights(message, destinations)
    if not stated:
        return None
    if any(not 1 <= count <= 30 for count in stated.values()):
        return SplitQuestion("How many nights, between one and thirty, should each stop have?")
    saved_windows = list(windows or [])
    maximum = _as_int(duration.get("maximumDays"))
    minimum = _as_int(duration.get("minimumDays"))
    current = _current_nights(destinations, duration)
    counts = dict(stated)

    unstated = [place for place in destinations if str(place.get("id", "")) not in counts]
    if unstated:
        # Silence means "keep what the itinerary already chose for that stop".
        kept = {str(place["id"]): _nights(place) for place in unstated if _nights(place) > 0}
        unknown = [place for place in unstated if str(place.get("id", "")) not in kept]
        if unknown:
            remaining = current - sum(counts.values()) - sum(kept.values())
            share, extra = divmod(remaining, len(unknown))
            if share < 1:
                names = " and ".join(str(place.get("name", "")) for place in unknown)
                return SplitQuestion(
                    f"The nights you gave leave no room for {names}. "
                    "Should I shorten another stop, or leave that stop out of the route?"
                )
            for index, place in enumerate(unknown):
                kept[str(place["id"])] = share + (1 if index < extra else 0)
        counts.update(kept)

    nights = sum(counts.values())
    span_days = nights + 1
    if maximum and span_days > maximum:
        return SplitQuestion(
            "May I extend your maximum duration to fit these nights? "
            "Update the duration limit in trip details before retrying."
        )
    if minimum and span_days < minimum:
        return SplitQuestion(
            f"These nights make a {span_days}-day trip, below your {minimum}-day minimum. "
            "Should I use the shorter route, or keep your minimum duration?"
        )

    start = _route_start(destinations, saved_windows, span_days)
    if start is None:
        return SplitQuestion("Which start date should the revised route use?")

    routed: list[Destination] = []
    plan: list[tuple[str, int]] = []
    cursor = start
    for index, place in enumerate(destinations):
        count = counts[str(place["id"])]
        departure = cursor + timedelta(days=count)
        routed.append(
            {
                **place,
                "routePosition": index,
                "arrivalDate": cursor.isoformat(),
                "departureDate": departure.isoformat(),
                "plannedNights": count,
            }
        )
        plan.append((str(place.get("name", "")), count))
        cursor = departure

    # Only reject dates this change made unbookable: a route that already ran past its
    # saved window keeps working exactly as before.
    saved = _saved_nights(destinations)
    if (
        saved_windows
        and saved is not None
        and _window_covers(saved_windows, saved[0][0], saved[-1][1])
        and not _window_covers(saved_windows, start, cursor)
    ):
        return SplitQuestion(
            f"Your new dates run from {start.isoformat()} to {cursor.isoformat()}, past the "
            "travel window you saved. Which dates should the revised route use?"
        )

    return RouteSplit(
        destinations=routed,
        nights=plan,
        start=start,
        end=cursor,
        previous_nights=current,
    )
