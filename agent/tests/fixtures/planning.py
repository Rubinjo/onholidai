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
