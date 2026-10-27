def complete_component_facts(
    kind: str, query: dict[str, object] | None = None
) -> dict[str, object]:
    query = query or {}
    return {
        "serviceStart": str(query.get("startDate", "2030-05-01")) + "T12:00:00Z",
        "serviceEnd": str(query.get("endDate", "2030-05-08")) + "T12:00:00Z",
        "details": {"description": "Synthetic planning facts", "type": kind},
        "cancellationTerms": "Unverified synthetic terms",
    }


def quoted_offers(
    query: dict[str, object],
    quotes: tuple[tuple[str, int], ...] = (("flight", 10000), ("accommodation", 10000)),
) -> list[dict[str, object]]:
    return [
        {
            "component": {
                **complete_component_facts(kind, query),
                "id": f"a0000000-a000-4000-8000-a{index:011}",
                "type": kind,
                "bookingStatus": "unbooked",
                "price": {
                    "currency": "EUR",
                    "finalCustomerMinor": price,
                    "taxesMinor": 0,
                    "feesMinor": 0,
                },
            }
        }
        for index, (kind, price) in enumerate(quotes, 1)
    ]
