from itertools import permutations
from math import asin, cos, radians, sin, sqrt
from typing import cast


def arrange_destinations(stops: list[dict[str, object]], policy: object) -> list[dict[str, object]]:
    """Propose a short geographic circuit; this does not verify transport feasibility."""
    if policy != "ai" or len(stops) < 3 or len(stops) > 8:
        return stops
    if any(not isinstance(stop.get("location"), dict) for stop in stops):
        return stops

    def distance(first: dict[str, object], second: dict[str, object]) -> float:
        a = cast(dict[str, float], first["location"])
        b = cast(dict[str, float], second["location"])
        lat1, lat2 = radians(a["latitude"]), radians(b["latitude"])
        dlat = lat2 - lat1
        dlon = radians(b["longitude"] - a["longitude"])
        return 2 * asin(
            min(1, sqrt(sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2))
        )

    def length(route: tuple[dict[str, object], ...]) -> float:
        return sum(
            distance(route[index], route[(index + 1) % len(route)]) for index in range(len(route))
        )

    # Fix the first stop for deterministic ties; origin legs are researched separately.
    routes = ((stops[0], *tail) for tail in permutations(stops[1:]))
    return list(min(routes, key=length))
