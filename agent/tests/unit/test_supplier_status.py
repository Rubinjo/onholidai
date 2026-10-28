from onholidai_agent.graph.estimate import research_scope, supplier_status_notes


def test_research_scope_reads_only_known_component_types():
    message = "Estimate my reviewed settings. Retry supplier research for: activity, flight."
    assert research_scope(message) == ["flight", "activity"]


def test_research_scope_defaults_to_full_research():
    assert research_scope("Estimate my reviewed settings and update my draft trip.") is None
    assert research_scope("Retry supplier research for: submarine.") is None


def test_supplier_status_notes_explain_each_failure_actionably():
    notes = supplier_status_notes(
        [
            {
                "componentType": "flight",
                "provider": "duffel",
                "status": "deadline",
            },
            {
                "componentType": "activity",
                "provider": "viator",
                "status": "access_blocked",
            },
            {"componentType": "accommodation", "provider": "nuitee", "status": "available"},
        ]
    )
    assert len(notes) == 2
    assert "Flight research through duffel is deadline" in notes[0]
    assert "no flight price is known" in notes[0]
    assert "retrying will not help until access is restored" in notes[1]


def test_supplier_status_notes_ignore_unknown_shapes():
    assert supplier_status_notes(None) == []
    assert supplier_status_notes(["unsupported", {"componentType": "rail"}]) == []
