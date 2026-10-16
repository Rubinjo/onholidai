from onholidai_agent.graph.route_policy import arrange_destinations


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
