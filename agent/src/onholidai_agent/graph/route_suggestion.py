"""Proactive route, stay and intercity advice for a reviewer-facing proposal.

Everything here is planning guidance, never sourced evidence: travel times come from
coordinates and typical speeds, and a stay is named only when a complete offer selected it.
"""

from itertools import pairwise
from typing import cast

from onholidai_agent.graph.route_policy import (
    arrange_destinations,
    place_coordinates,
    separation_km,
)

MAX_SUGGESTIONS = 24
MAX_SUGGESTION_CHARS = 500
# Guidance only: typical door-to-door speeds with a fixed allowance for terminal time.
_SHORT_LEG_KM = 350
_LONG_LEG_KM = 900


def _name(place: dict[str, object]) -> str:
    name = place.get("name")
    return name.strip() if isinstance(name, str) and name.strip() else "an unnamed stop"


def _nights(stop: dict[str, object]) -> int:
    nights = stop.get("plannedNights")
    return nights if isinstance(nights, int) and nights > 0 else 0


def _nights_label(nights: int) -> str:
    if nights <= 0:
        return "the stay"
    return "1 night" if nights == 1 else f"{nights} nights"


def route_sequence(stops: list[dict[str, object]], origin: dict[str, object] | None) -> str:
    """An ordered route from the return origin and back, with nights per city."""
    start = _name(origin) if origin else "your confirmed origin"
    if not stops:
        return f"A route from {start} back to {start}."
    stages = " → ".join(f"{_name(stop)} ({_nights_label(_nights(stop))})" for stop in stops)
    return f"{start} → {stages} → back to {start}"


def _hours(hours: float) -> str:
    return f"{max(0.5, round(hours * 2) / 2):g} hours"


def _mode(distance_km: float) -> tuple[str, float]:
    if distance_km <= _SHORT_LEG_KM:
        return "a rail or road transfer", distance_km / 70 + 0.5
    if distance_km <= _LONG_LEG_KM:
        return "high-speed rail or a short flight", distance_km / 250 + 1.0
    return "a flight", distance_km / 750 + 2.5


def _pairs(
    stops: list[dict[str, object]], origin: dict[str, object] | None
) -> list[tuple[dict[str, object], dict[str, object]]]:
    pairs = list(pairwise(stops))
    if origin is None:
        return pairs
    # A single stop's sourced flight already covers the return, so only longer routes
    # recommend the closing leg separately.
    closing = [(stops[-1], origin)] if len(stops) > 1 else []
    return [(origin, stops[0]), *pairs, *closing] if stops else []


def intercity_legs(stops: list[dict[str, object]], origin: dict[str, object] | None) -> list[str]:
    """Recommend a mode and approximate duration for every change of base."""
    lines: list[str] = []
    for first, second in _pairs(stops, origin):
        distance = separation_km(first, second)
        if distance is None:
            lines.append(
                f"{_name(first)} → {_name(second)}: transport mode, duration and cost remain "
                "unverified because a location is missing."
            )
            continue
        mode, hours = _mode(distance)
        lines.append(
            f"{_name(first)} → {_name(second)}: {mode}, roughly {_hours(hours)} door to door "
            f"({distance:.0f} km; unverified estimate, no transport inventory researched)."
        )
    return lines


def _location_name(stay: dict[str, object]) -> str | None:
    details = stay.get("planningDetails")
    if not isinstance(details, dict):
        return None
    location = cast(dict[str, object], details).get("locationName")
    return location.strip() if isinstance(location, str) and location.strip() else None


def _covers(stay: dict[str, object], stop: dict[str, object]) -> bool:
    arrival, departure = stop.get("arrivalDate"), stop.get("departureDate")
    start, end = stay.get("serviceStart"), stay.get("serviceEnd")
    if not all(isinstance(value, str) for value in (arrival, departure, start, end)):
        return False
    return str(start)[:10] <= str(arrival) and str(end)[:10] >= str(departure)


def stay_recommendations(
    stops: list[dict[str, object]], components: list[dict[str, object]]
) -> list[str]:
    """Name the stay selected for each city, or state that the city stays unresolved."""
    stays = [component for component in components if component.get("type") == "accommodation"]
    used: set[int] = set()
    lines: list[str] = []
    for stop in stops:
        matched = next(
            (
                index
                for index, stay in enumerate(stays)
                if index not in used and _covers(stay, stop)
            ),
            None,
        )
        nights = _nights(stop)
        stay_label = _nights_label(nights)
        if matched is None:
            lines.append(
                f"No sourced stay covers {_name(stop)}; accommodation there remains unresolved "
                "and unpriced."
            )
            continue
        used.add(matched)
        stay = stays[matched]
        provider = stay.get("provider")
        supplier = provider if isinstance(provider, str) and provider.strip() else "a supplier"
        lines.append(
            f"{_location_name(stay) or _name(stop)} in {_name(stop)} for {stay_label} "
            f"({supplier}, estimated; terms and availability unverified)."
        )
    return lines


def _circuit_km(stops: list[dict[str, object]], origins: list[dict[str, object]]) -> float | None:
    if not stops:
        return None
    located = [origin for origin in origins if place_coordinates(origin) is not None] or [None]
    totals: list[float] = []
    for origin in located:
        segments = [
            *([(origin, stops[0])] if origin is not None else []),
            *pairwise(stops),
            *([(stops[-1], origin)] if origin is not None else []),
        ]
        distances = [separation_km(first, second) for first, second in segments]
        if any(distance is None for distance in distances):
            return None
        totals.append(sum(cast(float, distance) for distance in distances))
    return sum(totals) / len(totals)


def shorter_circuit(stops: list[dict[str, object]], origins: list[dict[str, object]]) -> str | None:
    """A materially shorter order, offered as advice when the saved order is preserved."""
    if len(stops) < 2:
        return None
    current = _circuit_km(stops, origins)
    suggested = arrange_destinations(stops, "ai", origins or None)
    if current is None or suggested == stops:
        return None
    improved = _circuit_km(suggested, origins)
    if improved is None or improved > current * 0.9:
        return None
    return (
        "A shorter circuit would visit "
        + " → ".join(_name(stop) for stop in suggested)
        + f" (about {improved:.0f} km of travel instead of {current:.0f} km; unverified "
        "estimate). Your saved order stays unless you ask me to reorder it."
    )


def nearby_place_suggestions(facts: list[dict[str, object]]) -> list[str]:
    """Advisory nearby places from attributed research; nothing is added or priced."""
    lines: list[str] = []
    for fact in facts[:3]:
        text = str(fact.get("text", "")).strip()[:180]
        source = str(fact.get("sourceUrl", "")).strip()
        if not text or not source:
            continue
        lines.append(
            "Possible addition from unverified research, not priced or added to your route: "
            f"{text} (source: {source}). Ask me to plan it and it becomes a sourced stop."
        )
    return lines


def proposal_suggestions(
    stops: list[dict[str, object]],
    components: list[dict[str, object]],
    origin: dict[str, object] | None,
    *,
    origins: list[dict[str, object]] | None = None,
    research_facts: list[dict[str, object]] | None = None,
) -> list[str]:
    """The complete itinerary advice a traveller reviews: route, stays and intercity travel."""
    circuit = shorter_circuit(stops, origins) if origins else None
    lines = [
        *stay_recommendations(stops, components),
        *intercity_legs(stops, origin),
        *([circuit] if circuit else []),
        *nearby_place_suggestions(research_facts or []),
    ]
    return [
        line if len(line) <= MAX_SUGGESTION_CHARS else line[: MAX_SUGGESTION_CHARS - 1] + "…"
        for line in lines
        if line
    ][:MAX_SUGGESTIONS]
