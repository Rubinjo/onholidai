from typing import cast


def itinerary_details(component: dict[str, object]) -> dict[str, object]:
    """Bounded read-only enrichment; absent facts never become supplier promises."""
    details = cast(dict[str, object], component.get("details", {}))
    planning = cast(dict[str, object], component.get("planningDetails", {}))
    return {
        "componentId": component["id"],
        "type": component["type"],
        "serviceStart": component["serviceStart"],
        "serviceEnd": component["serviceEnd"],
        "details": details,
        "planningDetails": planning,
        "bookingRequirements": component.get("bookingRequirements", []),
        "cancellationTerms": component.get("cancellationTerms", "Unavailable"),
        "unavailableFacts": planning.get("unavailableFacts", ["Detailed supplier facts"]),
        "source": component.get("provider", "Unavailable"),
        "checkedAt": component.get("checkedAt"),
    }
