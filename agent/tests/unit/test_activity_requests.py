import asyncio
from copy import deepcopy
from itertools import pairwise
from typing import Any, cast
from uuid import uuid4

from onholidai_agent.graph.activity import activity_intent
from onholidai_agent.graph.clarify import compose_resumed_message
from onholidai_agent.graph.refine import refine
from onholidai_agent.models.api import CreateAgentRunRequest

TOKYO = "20000000-0000-4000-8000-000000000001"
OSAKA = "20000000-0000-4000-8000-000000000002"


def activity_offer(code: str, title: str, minutes: int = 120) -> dict[str, object]:
    return {
        "offerRef": str(uuid4()),
        "revision": 1,
        "component": {
            "id": str(uuid4()),
            "type": "activity",
            "provider": "viator",
            "supplierOfferId": code,
            "offerStatus": "available",
            "planningDetails": {
                "locationName": title,
                "durationMinutes": minutes,
                "source": "Viator",
            },
        },
        "evidence": {"status": "estimated", "availability": "unknown"},
    }


def trip_snapshot() -> dict[str, Any]:
    return {
        "destinations": [
            {
                "id": TOKYO,
                "name": "Tokyo",
                "timezone": "Asia/Tokyo",
                "arrivalDate": "2030-05-01",
                "departureDate": "2030-05-04",
                "plannedNights": 3,
                "location": {"latitude": 35.6895, "longitude": 139.6917},
            },
            {
                "id": OSAKA,
                "name": "Osaka",
                "timezone": "Asia/Tokyo",
                "arrivalDate": "2030-05-04",
                "departureDate": "2030-05-07",
                "plannedNights": 3,
                "location": {"latitude": 34.6938, "longitude": 135.5011},
            },
        ],
        "availabilityWindows": [
            {"startDate": "2030-05-01", "endDate": "2030-05-10", "preference": "preferred"}
        ],
        "duration": {"minimumDays": 5, "idealDays": 7, "maximumDays": 10},
        "preferences": {
            "pace": 50,
            "spend": 50,
            "setting": 50,
            "discovery": 50,
            "independence": 50,
        },
        "constraints": [],
        "components": [],
        "itineraryDays": [],
    }


class ActivitySource:
    def __init__(
        self,
        offers: list[dict[str, object]] | None = None,
        snapshot: dict[str, Any] | None = None,
    ) -> None:
        self.trip: dict[str, object] = {"version": 2, "snapshot": snapshot or trip_snapshot()}
        self.offers = offers or []
        self.queries: list[dict[str, object]] = []

    async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
        return self.trip

    async def activity_search(
        self, request: CreateAgentRunRequest, query: dict[str, object]
    ) -> dict[str, object]:
        self.queries.append(query)
        return {"offers": deepcopy(self.offers), "outcomes": [{"componentType": "activity"}]}


def request(message: str) -> CreateAgentRunRequest:
    return CreateAgentRunRequest.model_validate(
        {
            "contractVersion": "1",
            "requestId": str(uuid4()),
            "conversationId": str(uuid4()),
            "purpose": "refinement",
            "message": message,
            "actor": {
                "userId": str(uuid4()),
                "tripId": str(uuid4()),
                "baseTripVersion": 2,
                "scopes": ["trip:read", "context:read", "proposal:create"],
            },
            "context": {"tripSummary": {"version": 2}, "contextBudget": {"maximumTokens": 24000}},
        }
    )


def test_named_activity_request_infers_the_experience_name():
    intent = activity_intent("Add a Traditional Geisha Show activity to my stay in Tokyo")
    assert intent is not None
    assert intent.name == "Traditional Geisha Show"


def test_setting_changes_and_bookings_are_not_activity_requests():
    assert activity_intent("Add two nights in Tokyo") is None
    assert activity_intent("Set the pace to 25") is None


def test_activity_request_searches_the_named_stop_and_proposes_a_day_plan():
    source = ActivitySource(
        offers=[
            activity_offer("427786P52", "One Hour Geisha Show in Tokyo", 60),
            activity_offer(
                "5557073P1", "Tokyo Traditional Geisha Show and Japanese Food Experience", 150
            ),
            activity_offer("352022P58", "TOKYO:Traditional Geisha Show & Japanese Dinner", 90),
        ]
    )
    before = deepcopy(source.trip)
    result = asyncio.run(
        refine(request("Add a Traditional Geisha Show activity to my stay in Tokyo"), source)
    ).root
    assert result.kind == "proposal"
    assert [operation.target for operation in result.proposal.operations] == ["/itineraryDays"]
    assert source.queries == [
        {
            "componentTypes": ["activity"],
            "destinationIds": [TOKYO],
            "startDate": "2030-05-01",
            "endDate": "2030-05-04",
            "query": "Traditional Geisha Show",
        }
    ]
    days = cast(list[dict[str, Any]], result.proposal.operations[0].value)
    added = [
        item
        for day in days
        for item in day["items"]
        if item["title"] == "Tokyo Traditional Geisha Show and Japanese Food Experience"
    ]
    assert len(added) == 1
    assert added[0]["type"] == "activity"
    assert added[0]["componentId"] is None
    assert added[0]["verificationStatus"] == "unverified"
    assert added[0]["startOffset"] == "+09:00"
    assert added[0]["componentId"] is None
    assert "Sourced from Viator, 5557073P1" in " ".join(added[0]["practicalNotes"])
    for day in days:
        ordered = sorted(day["items"], key=lambda item: item["start"])
        for previous, current in pairwise(ordered):
            assert current["start"] >= previous["end"], (day["date"], previous, current)
    assert source.trip == before


def test_two_stops_without_a_named_destination_ask_one_focused_question():
    result = asyncio.run(refine(request("Add a geisha show to my trip"), ActivitySource())).root
    assert result.kind == "clarification"
    assert "Tokyo" in result.clarification.question
    assert "Osaka" in result.clarification.question
    assert result.clarification.question.count("?") == 1


def test_no_matching_listing_is_answered_without_a_broad_question():
    source = ActivitySource(offers=[activity_offer("130036P2", "Osaka Food Tour")])
    result = asyncio.run(
        refine(request("Add a Traditional Geisha Show activity to my stay in Tokyo"), source)
    ).root
    assert result.kind == "answer"
    assert "Tokyo" in result.message
    assert "Nothing was added" in result.message


def test_equally_close_candidates_become_a_focused_choice_between_titles():
    source = ActivitySource(
        offers=[
            activity_offer("427786P52", "Tokyo Traditional Geisha Show", 60),
            activity_offer("427786P10", "Tokyo Traditional Geisha Dinner", 60),
        ]
    )
    result = asyncio.run(
        refine(request("Add a traditional geisha show dinner to my stay in Tokyo"), source)
    ).root
    assert result.kind == "clarification"
    assert "Tokyo Traditional Geisha Show" in result.clarification.question
    assert "Tokyo Traditional Geisha Dinner" in result.clarification.question
    assert result.clarification.question.count("?") == 1


def test_a_polite_lead_in_is_not_part_of_the_experience_name():
    intent = activity_intent("Can we add a traditional Geisha show in Tokyo?")
    assert intent is not None
    assert intent.name == "traditional Geisha show"
    assert intent.answers == ()


def test_an_answer_is_kept_apart_from_the_request():
    intent = activity_intent(
        compose_resumed_message("Add a geisha show in Tokyo", "Tokyo Traditional Geisha Show")
    )
    assert intent is not None
    assert intent.name == "geisha show"
    assert intent.answers == ("Tokyo Traditional Geisha Show",)


def test_the_reported_clarification_adds_the_listing_the_traveller_named():
    # Trip 3d1ea5d6 asked this forever: the traveller answered with the exact title and
    # the same question came back because the answer never reached the selection.
    offered = "Tokyo Traditional Geisha Show and Japanese Food Experience"
    source = ActivitySource(
        offers=[
            activity_offer("5557073P1", offered, 150),
            activity_offer("352022P58", "TOKYO:Traditional Geisha Show & Japanese Dinner", 90),
        ]
    )
    result = asyncio.run(
        refine(
            request(
                compose_resumed_message("Can we add a traditional Geisha show in Tokyo?", offered)
            ),
            source,
        )
    ).root
    assert result.kind == "proposal"
    days = cast(list[dict[str, Any]], result.proposal.operations[0].value)
    titles = [item.get("title") for day in days for item in day["items"]]
    assert offered in titles
    assert "TOKYO:Traditional Geisha Show & Japanese Dinner" not in titles


def test_an_answered_choice_selects_the_named_title():
    source = ActivitySource(
        offers=[
            activity_offer("427786P52", "Tokyo Traditional Geisha Show", 60),
            activity_offer("427786P10", "Tokyo Traditional Geisha Dinner", 60),
        ]
    )
    result = asyncio.run(
        refine(
            request(
                compose_resumed_message(
                    "Add a traditional geisha show dinner to my stay in Tokyo",
                    "Tokyo Traditional Geisha Dinner",
                )
            ),
            source,
        )
    ).root
    assert result.kind == "proposal"
    days = cast(list[dict[str, Any]], result.proposal.operations[0].value)
    titles = [item.get("title") for day in days for item in day["items"]]
    assert "Tokyo Traditional Geisha Dinner" in titles
    assert "Tokyo Traditional Geisha Show" not in titles


def test_an_answer_that_names_no_listing_ends_the_run_instead_of_asking_again():
    source = ActivitySource(
        offers=[
            activity_offer("427786P52", "Tokyo Traditional Geisha Show", 60),
            activity_offer("427786P10", "Tokyo Traditional Geisha Dinner", 60),
        ]
    )
    result = asyncio.run(
        refine(
            request(
                compose_resumed_message(
                    "Add a traditional geisha show dinner to my stay in Tokyo", "the first one"
                )
            ),
            source,
        )
    ).root
    assert result.kind == "answer"
    assert "nothing changed" in result.message
    assert "Which sourced Tokyo activity" in result.message


def test_an_answered_stop_is_used_instead_of_asking_which_stop():
    source = ActivitySource(offers=[activity_offer("130036P2", "Geisha Show", 60)])
    result = asyncio.run(
        refine(request(compose_resumed_message("Add a geisha show to my trip", "Osaka")), source)
    ).root
    assert result.kind == "proposal"
    assert source.queries[0]["destinationIds"] == [OSAKA]


def test_a_listing_named_for_the_stop_wins_a_tied_text_match():
    source = ActivitySource(
        offers=[
            activity_offer("427786P10", "Geisha Show in Kyoto", 60),
            activity_offer("427786P52", "Geisha Show in Tokyo", 60),
        ]
    )
    result = asyncio.run(refine(request("Add a geisha show in Tokyo"), source)).root
    assert result.kind == "proposal"
    days = cast(list[dict[str, Any]], result.proposal.operations[0].value)
    titles = [item.get("title") for day in days for item in day["items"]]
    assert "Geisha Show in Tokyo" in titles
    assert "Geisha Show in Kyoto" not in titles


def test_a_planned_activity_is_never_duplicated():
    snapshot = trip_snapshot()
    snapshot["itineraryDays"] = [
        {
            "date": "2030-05-02",
            "destinationId": TOKYO,
            "timezone": "Asia/Tokyo",
            "paceAssessment": 50,
            "items": [
                {
                    "id": str(uuid4()),
                    "type": "activity",
                    "title": "Tokyo Traditional Geisha Show and Japanese Food Experience",
                    "start": "2030-05-02T19:00",
                    "end": "2030-05-02T20:30",
                    "componentId": None,
                    "status": "planned",
                    "verificationStatus": "unverified",
                }
            ],
        }
    ]
    source = ActivitySource(
        offers=[activity_offer("5557073P1", "Tokyo Traditional Geisha Show", 90)],
        snapshot=snapshot,
    )
    result = asyncio.run(
        refine(request("Add a Traditional Geisha Show activity to my stay in Tokyo"), source)
    ).root
    assert result.kind == "answer"
    assert "already planned" in result.message
    assert "2030-05-02" in result.message
    assert source.queries == []


def test_required_free_mornings_move_the_activity_later():
    snapshot = trip_snapshot()
    snapshot["components"] = [
        {
            "id": str(uuid4()),
            "type": "accommodation",
            "provider": "nuitee",
            "supplierOfferId": "stay-tokyo",
            "offerStatus": "available",
            "serviceStart": "2030-05-01T00:00:00Z",
            "serviceEnd": "2030-05-04T00:00:00Z",
            "bookingStatus": "unbooked",
            "details": None,
        }
    ]
    snapshot["constraints"] = [
        {
            "id": str(uuid4()),
            "category": "schedule",
            "statement": "Keep mornings free; no activities before 10:00",
            "priority": "required",
            "status": "active",
        }
    ]
    snapshot["itineraryDays"] = [
        {
            "date": "2030-05-02",
            "destinationId": TOKYO,
            "timezone": "Asia/Tokyo",
            "paceAssessment": 50,
            "items": [],
        }
    ]
    source = ActivitySource(
        offers=[activity_offer("5557073P1", "Tokyo Traditional Geisha Show", 90)],
        snapshot=snapshot,
    )
    result = asyncio.run(
        refine(request("Add a Traditional Geisha Show activity to my stay in Tokyo"), source)
    ).root
    assert result.kind == "proposal"
    days = cast(list[dict[str, Any]], result.proposal.operations[0].value)
    added = [
        item
        for day in days
        for item in day["items"]
        if item["title"] == "Tokyo Traditional Geisha Show"
    ]
    assert added[0]["start"][11:] >= "10:00"
