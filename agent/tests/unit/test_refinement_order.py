from typing import cast

from onholidai_agent.graph.refine import preserve_manual_destination_order


def test_manual_refinement_keeps_existing_stop_order_and_appends_new_stops():
    destinations: list[dict[str, object]] = [
        {"id": name, "routePosition": index} for index, name in enumerate("abc")
    ]
    proposed: list[dict[str, object]] = [
        {"id": "new", "routePosition": 0},
        {"id": "c", "routePosition": 1},
        {"id": "a", "routePosition": 2},
        {"id": "b", "routePosition": 3},
    ]
    operations: list[dict[str, object]] = [
        {"operation": "replace", "target": "/destinations", "value": proposed}
    ]

    result = preserve_manual_destination_order(
        {"destinations": destinations}, operations, "Add another stop"
    )
    ordered = cast(list[dict[str, object]], result[0]["value"])

    assert [entry["id"] for entry in ordered] == ["a", "b", "c", "new"]
    assert [entry["routePosition"] for entry in ordered] == [0, 1, 2, 3]
    assert [entry["id"] for entry in proposed] == ["new", "c", "a", "b"]

    reordered = preserve_manual_destination_order(
        {"destinations": destinations},
        [{"operation": "reorder", "target": "/destinations", "value": ["c", "a", "b"]}],
        "Add another stop",
    )
    assert cast(list[str], reordered[0]["value"]) == ["a", "b", "c"]


def test_explicit_manual_reorder_and_ai_proposals_are_preserved_for_review():
    destinations: list[dict[str, object]] = [
        {"id": name, "routePosition": index} for index, name in enumerate("abc")
    ]
    proposed: list[dict[str, object]] = [
        {"id": name, "routePosition": index} for index, name in enumerate("cab")
    ]
    operations: list[dict[str, object]] = [
        {"operation": "replace", "target": "/destinations", "value": proposed}
    ]

    manual = preserve_manual_destination_order(
        {"destinationOrder": "manual", "destinations": destinations},
        operations,
        "Reorder the stops with C first",
    )
    ai = preserve_manual_destination_order(
        {"destinationOrder": "ai", "destinations": destinations}, operations, "Add another stop"
    )

    assert manual == operations
    assert ai == operations
