from itertools import pairwise, permutations
from math import asin, cos, isfinite, radians, sin, sqrt
from typing import cast


def _coordinates(place: dict[str, object]) -> tuple[float, float] | None:
    location = place.get("location")
    if not isinstance(location, dict):
        return None
    point = cast(dict[str, object], location)
    latitude, longitude = point.get("latitude"), point.get("longitude")
    if (
        not isinstance(latitude, (int, float))
        or isinstance(latitude, bool)
        or not isinstance(longitude, (int, float))
        or isinstance(longitude, bool)
        or not isfinite(latitude)
        or not isfinite(longitude)
        or not -90 <= latitude <= 90
        or not -180 <= longitude <= 180
    ):
        return None
    return float(latitude), float(longitude)


def _distance(first: dict[str, object], second: dict[str, object]) -> float:
    a = cast(dict[str, float], first["location"])
    b = cast(dict[str, float], second["location"])
    lat1, lat2 = radians(a["latitude"]), radians(b["latitude"])
    dlat, dlon = lat2 - lat1, radians(b["longitude"] - a["longitude"])
    return 2 * asin(
        min(1, sqrt(sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2))
    )


def arrange_destinations(
    stops: list[dict[str, object]],
    policy: object,
    departure_origins: list[dict[str, object]] | None = None,
) -> list[dict[str, object]]:
    """Propose a short geographic circuit; this does not verify transport feasibility."""
    if policy != "ai" or len(stops) < 3 or len(stops) > 8:
        return stops
    if any(_coordinates(stop) is None for stop in stops):
        return stops
    if departure_origins is not None and (
        not departure_origins or any(_coordinates(origin) is None for origin in departure_origins)
    ):
        return stops

    places = [*stops, *(departure_origins or [])]
    distances = [[_distance(first, second) for second in places] for first in places]
    stop_count = len(stops)
    if departure_origins is not None:

        def round_trip_length(route: tuple[int, ...]) -> float:
            origin_indices = range(stop_count, len(places))
            totals: list[float] = []
            for origin_index in origin_indices:
                totals.append(
                    distances[origin_index][route[0]]
                    + sum(
                        distances[left][right]
                        for left, right in pairwise(route)
                    )
                    + distances[route[-1]][origin_index]
                )
            return sum(totals) / len(totals)

        best = min(permutations(range(stop_count)), key=round_trip_length)
        return [stops[index] for index in best]

    def circuit_length(route: tuple[int, ...]) -> float:
        return sum(
            distances[route[index]][route[(index + 1) % len(route)]]
            for index in range(len(route))
        )

    # A destination-only circuit is rotationally symmetric, so fix its first stop.
    best = min(
        ((0, *tail) for tail in permutations(range(1, stop_count))),
        key=circuit_length,
    )
    return [stops[index] for index in best]
