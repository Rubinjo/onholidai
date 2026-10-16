from onholidai_agent.graph.route_policy import arrange_destinations


def distance(first: dict[str, object], second: dict[str, object]) -> float:
    from math import asin, cos, radians, sin, sqrt
    from typing import cast

    a = cast(dict[str, float], first["location"])
    b = cast(dict[str, float], second["location"])
    lat1, lat2 = radians(a["latitude"]), radians(b["latitude"])
    dlat, dlon = lat2 - lat1, radians(b["longitude"] - a["longitude"])
    return 2 * asin(
        min(1, sqrt(sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2))
    )


def test_manual_order_and_incomplete_geometry_are_preserved():
    stops: list[dict[str, object]] = [{"id": "a"}, {"id": "b"}]
    assert arrange_destinations(stops, "manual") == stops
    assert arrange_destinations(stops, "ai") == stops


def test_ai_can_propose_a_shorter_geographic_circuit_without_mutating_input():
    stops: list[dict[str, object]] = [
        {"id": name, "location": {"latitude": lat, "longitude": lon}}
        for name, lat, lon in [("a", 0, 0), ("c", 10, 10), ("b", 0, 10), ("d", 10, 0)]
    ]
    result = arrange_destinations(stops, "ai")
    assert {entry["id"] for entry in result} == {"a", "b", "c", "d"}
    assert result != stops
    assert stops[1]["id"] == "c"


def test_ai_order_accounts_for_confirmed_departure_and_return_legs():
    stops: list[dict[str, object]] = [
        {"id": name, "location": {"latitude": 0, "longitude": longitude}}
        for name, longitude in [("a", 0), ("c", 20), ("b", 10), ("d", 30)]
    ]
    origins: list[dict[str, object]] = [
        {"placeId": "home-west", "location": {"latitude": 0, "longitude": 0}},
        {"placeId": "home-east", "location": {"latitude": 20, "longitude": 20}},
    ]
    result = arrange_destinations(stops, "ai", origins)

    def round_trip_length(route: list[dict[str, object]]) -> float:
        return sum(
            distance(origin, route[0])
            + sum(distance(route[index], route[index + 1]) for index in range(len(route) - 1))
            + distance(route[-1], origin)
            for origin in origins
        ) / len(origins)

    assert round_trip_length(result) < round_trip_length(stops)
    assert {entry["id"] for entry in result} == {"a", "b", "c", "d"}
    assert stops[1]["id"] == "c"


def test_manual_and_missing_geography_keep_the_confirmed_order():
    stops: list[dict[str, object]] = [
        {"id": "a", "location": {"latitude": 0, "longitude": 0}},
        {"id": "c", "location": None},
        {"id": "b", "location": {"latitude": 0, "longitude": 10}},
    ]
    origins: list[dict[str, object]] = [
        {"placeId": "home-west", "location": {"latitude": 0, "longitude": 0}},
        {"placeId": "home-east", "location": None},
    ]
    assert arrange_destinations(stops, "manual", origins) == stops
    assert arrange_destinations(stops, "ai", origins) == stops
