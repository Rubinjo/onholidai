def complete_component_facts(kind: str) -> dict[str, object]:
    return {
        "serviceStart": "2030-05-01T12:00:00Z",
        "serviceEnd": "2030-05-08T12:00:00Z",
        "details": {"description": "Synthetic planning facts", "type": kind},
        "cancellationTerms": "Unverified synthetic terms",
    }
