import asyncio
from copy import deepcopy
from typing import Any, cast
from uuid import uuid4

from onholidai_agent.graph.finalize import compose_itinerary
from onholidai_agent.graph.refine import compose_refinement
from onholidai_agent.models.api import CreateAgentRunRequest


def test_itinerary_is_a_reviewable_proposal_and_preserves_authoritative_choices():
    snapshot: dict[str, Any] = {
        "destinations": [
            {
                "id": str(uuid4()),
                "name": "Lisbon",
                "timezone": "Europe/Lisbon",
                "arrivalDate": "2030-05-01",
                "departureDate": "2030-05-02",
                "plannedNights": 1,
                "location": None,
            }
        ],
        "preferences": {"pace": 25, "discovery": 70, "setting": 50, "independence": 50},
        "constraints": [],
        "components": [],
    }
    before = deepcopy(snapshot)

    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {"version": 2, "snapshot": snapshot}

    request = CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": str(uuid4()),
            "purpose": "finalization",
            "conversationId": str(uuid4()),
            "actor": {
                "userId": str(uuid4()),
                "tripId": str(uuid4()),
                "baseTripVersion": 2,
                "scopes": ["trip:read", "proposal:create"],
            },
            "message": "Prepare detailed itinerary",
            "context": {"tripSummary": {"version": 2}, "contextBudget": {"maximumTokens": 16000}},
        }
    )
    result = asyncio.run(compose_itinerary(request, Reader())).root
    assert result.kind == "proposal"
    assert result.proposal.purpose == "finalization"
    assert [operation.target for operation in result.proposal.operations] == ["/itineraryDays"]
    assert snapshot == before
    days = cast("list[dict[str, Any]]", result.proposal.operations[0].value)
    assert len(days) == 2
    for day in days:
        titles = sorted(item["title"] for item in day["items"])
        assert titles == ["Evening meal", "Lunch", "Morning meal"]
        assert all(item["type"] == "meal" for item in day["items"])
        assert all(item["verificationStatus"] == "unverified" for item in day["items"])


def planning_request(message: str, purpose: str = "refinement") -> CreateAgentRunRequest:
    return CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": str(uuid4()),
            "conversationId": str(uuid4()),
            "purpose": purpose,
            "message": message,
            "actor": {
                "userId": str(uuid4()),
                "tripId": str(uuid4()),
                "baseTripVersion": 2,
                "scopes": ["trip:read", "proposal:create"],
            },
            "context": {"tripSummary": {"version": 2}, "contextBudget": {"maximumTokens": 16000}},
        }
    )


def test_required_rail_asks_once_then_keeps_the_requirement_unresolved_across_supported_planning():
    snapshot: dict[str, object] = {
        "destinations": [
            {
                "id": str(uuid4()),
                "name": "Lisbon",
                "timezone": "Europe/Lisbon",
                "arrivalDate": "2030-05-01",
                "departureDate": "2030-05-02",
                "plannedNights": 1,
            }
        ],
        "preferences": {"pace": 25, "discovery": 50, "setting": 50, "independence": 50},
        "constraints": [
            {
                "category": "transport",
                "priority": "required",
                "status": "active",
                "statement": "Use rail between destinations",
            }
        ],
        "components": [],
    }
    before = deepcopy(snapshot)

    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {"version": 2, "snapshot": snapshot}

    initial = planning_request("Prepare itinerary", "finalization")
    question = asyncio.run(compose_itinerary(initial, Reader())).root
    assert question.kind == "clarification"
    assert "rail" in question.clarification.question.lower()
    resumed = initial.model_copy(
        update={"message": "Keep rail unresolved while planning supported parts"}
    )
    result = asyncio.run(compose_itinerary(resumed, Reader())).root
    assert result.kind == "proposal"
    assert any(
        "Required rail remains unresolved" in warning for warning in result.proposal.warnings
    )
    raw = initial.model_dump(mode="json", by_alias=True)
    raw["context"]["conversationSummary"] = {
        "sourceTripVersion": 2,
        "decisions": ["Keep rail unresolved while planning supported parts"],
    }
    later = asyncio.run(compose_itinerary(CreateAgentRunRequest.model_validate(raw), Reader())).root
    assert later.kind == "proposal"
    assert snapshot == before


def test_missing_timezone_requires_clarification_without_inventing_one():
    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {
                "version": 2,
                "snapshot": {
                    "destinations": [{"id": str(uuid4()), "name": "Paris"}],
                    "preferences": {},
                    "components": [],
                },
            }

    result = asyncio.run(
        compose_itinerary(planning_request("Prepare itinerary", "finalization"), Reader())
    ).root
    assert result.kind == "clarification"
    assert "timezone" in result.clarification.question


def test_lower_priority_activity_changes_are_proposals_and_preserve_supplier_items():
    activity_id = str(uuid4())
    snapshot: dict[str, Any] = {
        "destinations": [],
        "preferences": {},
        "constraints": [],
        "components": [],
        "itineraryDays": [
            {
                "date": "2030-05-01",
                "timezone": "Europe/Lisbon",
                "items": [
                    {
                        "id": activity_id,
                        "type": "activity",
                        "componentId": None,
                        "start": "2030-05-01T10:00",
                        "end": "2030-05-01T12:00",
                    }
                ],
            }
        ],
    }

    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {"version": 2, "snapshot": snapshot}

    for message, count in [
        (f"Remove activity {activity_id}", 0),
        (f"Move activity {activity_id} to 2030-05-01 at 14:00", 1),
    ]:
        before = deepcopy(snapshot)
        result = asyncio.run(compose_refinement(planning_request(message), Reader())).root
        assert result.kind == "proposal"
        days = cast("list[dict[str, Any]]", result.proposal.operations[0].value)
        assert len(days[0]["items"]) == count
        assert snapshot == before
    snapshot["itineraryDays"][0]["items"][0]["componentId"] = str(uuid4())
    result = asyncio.run(
        compose_refinement(planning_request(f"Remove activity {activity_id}"), Reader())
    ).root
    assert result.kind == "clarification"


def test_round_trip_fare_plans_both_flights_with_their_own_duration_and_clocks():
    tokyo_id, flight_id = str(uuid4()), str(uuid4())
    snapshot: dict[str, Any] = {
        "departureOrigin": {"name": "London", "timezone": "Europe/London", "airportCode": "LHR"},
        "availabilityWindows": [
            {
                "startDate": "2026-11-01",
                "endDate": "2026-11-07",
                "preference": "preferred",
                "timezone": "Europe/London",
            }
        ],
        "destinations": [
            {
                "id": tokyo_id,
                "name": "Tokyo",
                "timezone": "Asia/Tokyo",
                "arrivalDate": "2026-11-01",
                "departureDate": "2026-11-07",
                "plannedNights": 6,
                "location": None,
            }
        ],
        "preferences": {"pace": 50, "discovery": 50, "setting": 50, "independence": 50},
        "constraints": [],
        "components": [
            {
                "id": flight_id,
                "type": "flight",
                "provider": "duffel",
                "checkedAt": "2026-10-01T00:00:00Z",
                # The fare's own window spans the whole trip; it is not one flight.
                "serviceStart": "2026-10-31T23:00:00Z",
                "serviceEnd": "2026-11-07T08:30:00Z",
                "details": None,
                "planningDetails": {
                    "flightDirection": "return",
                    "flightJourneys": [
                        {
                            "direction": "outbound",
                            "origin": "LHR",
                            "destination": "HND",
                            "originTimezone": "Europe/London",
                            "destinationTimezone": "Asia/Tokyo",
                            "departingAt": "2026-10-31T23:00:00Z",
                            "arrivingAt": "2026-11-01T08:30:00Z",
                            "legs": ["LHR ? HND"],
                        },
                        {
                            "direction": "return",
                            "origin": "HND",
                            "destination": "LHR",
                            "originTimezone": "Asia/Tokyo",
                            "destinationTimezone": "Europe/London",
                            "departingAt": "2026-11-07T00:00:00Z",
                            "arrivingAt": "2026-11-07T08:30:00Z",
                            "legs": ["HND ? LHR"],
                        },
                    ],
                },
            }
        ],
    }

    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {"version": 2, "snapshot": snapshot}

    result = asyncio.run(
        compose_itinerary(planning_request("Prepare itinerary", "finalization"), Reader())
    ).root
    assert result.kind == "proposal"
    days = cast("list[dict[str, Any]]", result.proposal.operations[0].value)
    assert [day["date"] for day in days] == [
        "2026-11-01",
        "2026-11-02",
        "2026-11-03",
        "2026-11-04",
        "2026-11-05",
        "2026-11-06",
        "2026-11-07",
    ]
    flights = {
        day["date"]: [item for item in day["items"] if item["type"] == "travel"] for day in days
    }
    assert [date for date, items in flights.items() if items] == ["2026-11-01", "2026-11-07"]
    outbound = flights["2026-11-01"][0]["travelSegment"]
    assert outbound["durationMinutes"] == 570
    assert outbound["plannedDeparture"] == "2026-10-31T23:00:00+00:00"
    assert outbound["plannedArrival"] == "2026-11-01T17:30:00+09:00"
    assert outbound["origin"] == {
        "placeId": f"{flight_id}-origin",
        "name": "LHR",
        "timezone": "Europe/London",
        "location": None,
    }
    assert outbound["destination"]["timezone"] == "Asia/Tokyo"
    made_up = [item for day in days for item in day["items"] if item["type"] != "meal"]
    assert all(item["componentId"] == flight_id for item in made_up if item["type"] == "travel")
    assert not any(item["type"] in ("activity", "free_time") for item in made_up)
    returned = flights["2026-11-07"][0]["travelSegment"]
    assert returned["durationMinutes"] == 510
    assert returned["plannedDeparture"] == "2026-11-07T09:00:00+09:00"
    assert returned["plannedArrival"] == "2026-11-07T08:30:00+00:00"
    assert all(
        segment["durationMinutes"] < 24 * 60
        for items in flights.values()
        for segment in (item["travelSegment"] for item in items)
    )


def test_westbound_flight_lands_on_the_day_it_arrives_without_time_travel_blocks():
    city_id, flight_id = str(uuid4()), str(uuid4())
    snapshot: dict[str, Any] = {
        "availabilityWindows": [
            {
                "startDate": "2026-11-01",
                "endDate": "2026-11-02",
                "preference": "preferred",
                "timezone": "Europe/London",
            }
        ],
        "destinations": [
            {
                "id": city_id,
                "name": "New York",
                "timezone": "America/New_York",
                "arrivalDate": "2026-11-01",
                "departureDate": "2026-11-02",
                "plannedNights": 1,
                "location": None,
            }
        ],
        "preferences": {"pace": 50, "discovery": 50, "setting": 50, "independence": 50},
        "constraints": [],
        "components": [
            {
                "id": flight_id,
                "type": "flight",
                "provider": "duffel",
                "checkedAt": "2026-10-01T00:00:00Z",
                "serviceStart": "2026-11-01T02:00:00Z",
                "serviceEnd": "2026-11-01T12:00:00Z",
                "details": None,
                "planningDetails": {
                    "flightJourneys": [
                        {
                            "direction": "outbound",
                            "origin": "LHR",
                            "destination": "JFK",
                            "originTimezone": "Europe/London",
                            "destinationTimezone": "America/New_York",
                            "departingAt": "2026-11-01T02:00:00Z",
                            "arrivingAt": "2026-11-01T12:00:00Z",
                            "legs": ["LHR ? JFK"],
                        }
                    ]
                },
            }
        ],
    }

    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {"version": 2, "snapshot": snapshot}

    result = asyncio.run(
        compose_itinerary(planning_request("Prepare itinerary", "finalization"), Reader())
    ).root
    assert result.kind == "proposal"
    days = cast("list[dict[str, Any]]", result.proposal.operations[0].value)
    arrival_day = next(day for day in days if day["date"] == "2026-11-01")
    travel = [item for item in arrival_day["items"] if item["type"] == "travel"]
    assert len(travel) == 1
    item = travel[0]
    assert item["start"] == "2026-11-01T00:00:00"
    assert item["end"] == "2026-11-01T07:00:00"
    assert item["travelSegment"]["durationMinutes"] == 600
    assert item["travelSegment"]["plannedDeparture"] == "2026-11-01T02:00:00+00:00"
    assert item["travelSegment"]["plannedArrival"] == "2026-11-01T07:00:00-05:00"
    assert all(entry["start"][:10] == day["date"] for day in days for entry in day["items"])


def test_saved_fare_without_journey_facts_warns_instead_of_inventing_a_long_flight():
    destination_id = str(uuid4())
    snapshot: dict[str, Any] = {
        "availabilityWindows": [
            {
                "startDate": "2026-11-01",
                "endDate": "2026-11-03",
                "preference": "preferred",
                "timezone": "Asia/Tokyo",
            }
        ],
        "destinations": [
            {
                "id": destination_id,
                "name": "Tokyo",
                "timezone": "Asia/Tokyo",
                "arrivalDate": "2026-11-01",
                "departureDate": "2026-11-03",
                "plannedNights": 2,
                "location": None,
            }
        ],
        "preferences": {"pace": 50, "discovery": 50, "setting": 50, "independence": 50},
        "constraints": [],
        # A fare saved before per-flight journey facts existed: only its window is known.
        "components": [
            {
                "id": str(uuid4()),
                "type": "flight",
                "provider": "duffel",
                "checkedAt": "2026-10-01T00:00:00Z",
                "serviceStart": "2026-10-31T23:00:00Z",
                "serviceEnd": "2026-11-10T10:58:00Z",
                "details": None,
                "planningDetails": {"flightDirection": None},
            }
        ],
    }

    class Reader:
        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return {"version": 2, "snapshot": snapshot}

    result = asyncio.run(
        compose_itinerary(planning_request("Prepare itinerary", "finalization"), Reader())
    ).root
    assert result.kind == "proposal"
    assert any(
        "Refresh the flights" in warning for warning in result.proposal.warnings
    ), result.proposal.warnings
