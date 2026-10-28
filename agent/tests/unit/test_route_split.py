from datetime import date

from onholidai_agent.graph.route_split import SplitQuestion, plan_route_split, stated_nights

TOKYO: dict[str, object] = {
    "id": "10000000-0000-4000-8000-000000000005",
    "name": "Tokyo",
    "plannedNights": 3,
    "arrivalDate": "2030-05-01",
    "departureDate": "2030-05-04",
    "routePosition": 0,
}
KYOTO: dict[str, object] = {
    "id": "10000000-0000-4000-8000-000000000006",
    "name": "Kyoto",
    "plannedNights": 3,
    "arrivalDate": "2030-05-04",
    "departureDate": "2030-05-07",
    "routePosition": 1,
}
OSAKA: dict[str, object] = {
    "id": "10000000-0000-4000-8000-000000000007",
    "name": "Osaka",
    "plannedNights": 2,
    "arrivalDate": "2030-05-07",
    "departureDate": "2030-05-09",
    "routePosition": 2,
}
DURATION: dict[str, object] = {"minimumDays": 5, "idealDays": 7, "maximumDays": 9}
LONG_TRIP: dict[str, object] = {"minimumDays": 5, "idealDays": 7, "maximumDays": 12}
WINDOWS: list[dict[str, object]] = [
    {
        "id": "10000000-0000-4000-8000-000000000008",
        "startDate": "2030-05-01",
        "endDate": "2030-05-31",
        "preference": "preferred",
        "timezone": "Asia/Tokyo",
    }
]


def test_stated_nights_reads_digits_words_and_either_word_order():
    destinations = [TOKYO, KYOTO]
    assert stated_nights("4 nights in Tokyo and 2 nights in Kyoto", destinations) == {
        TOKYO["id"]: 4,
        KYOTO["id"]: 2,
    }
    assert stated_nights("four nights in Tokyo, two nights in Kyoto", destinations) == {
        TOKYO["id"]: 4,
        KYOTO["id"]: 2,
    }
    assert stated_nights("Tokyo for 4 nights then Kyoto for 2 nights", destinations) == {
        TOKYO["id"]: 4,
        KYOTO["id"]: 2,
    }


def test_stated_nights_ignores_a_clause_that_names_more_than_one_stop():
    assert stated_nights("4 nights in Tokyo/Kyoto", [TOKYO, KYOTO]) == {}


def test_stated_nights_matches_a_stop_that_carries_its_country():
    japan_tokyo = {**TOKYO, "name": "Tokyo, Japan"}
    japan_kyoto = {**KYOTO, "name": "Kyoto (Japan)"}
    assert stated_nights("4 nights in Tokyo and 2 nights in Kyoto", [japan_tokyo, japan_kyoto]) == {
        TOKYO["id"]: 4,
        KYOTO["id"]: 2,
    }


def test_unmentioned_stop_keeps_the_nights_the_saved_plan_already_chose():
    split = plan_route_split(
        "4 nights in Tokyo and 2 nights in Osaka", [TOKYO, KYOTO, OSAKA], LONG_TRIP, WINDOWS
    )
    assert not isinstance(split, (SplitQuestion, type(None)))
    assert [count for _, count in split.nights] == [4, 3, 2]
    assert split.start == date(2030, 5, 1)
    assert [place["departureDate"] for place in split.destinations] == [
        "2030-05-05",
        "2030-05-08",
        "2030-05-10",
    ]


def test_undated_route_is_dated_from_the_saved_window_instead_of_asking():
    undated = [
        {**TOKYO, "plannedNights": 0, "arrivalDate": None, "departureDate": None},
        {
            **OSAKA,
            "plannedNights": 0,
            "arrivalDate": None,
            "departureDate": None,
            "routePosition": 1,
        },
    ]
    split = plan_route_split("4 nights in Tokyo and 2 nights in Osaka", undated, DURATION, WINDOWS)
    assert not isinstance(split, (SplitQuestion, type(None)))
    assert [(place["plannedNights"], place["arrivalDate"]) for place in split.destinations] == [
        (4, "2030-05-01"),
        (2, "2030-05-05"),
    ]


def test_split_beyond_the_maximum_duration_asks_one_question():
    split = plan_route_split(
        "4 nights in Tokyo and 6 nights in Kyoto", [TOKYO, KYOTO], DURATION, WINDOWS
    )
    assert isinstance(split, SplitQuestion)
    assert split.text.count("?") == 1


def test_split_with_no_nights_left_for_a_named_stop_asks_one_question():
    unscheduled = {**OSAKA, "plannedNights": 0, "arrivalDate": None, "departureDate": None}
    split = plan_route_split(
        "3 nights in Tokyo and 3 nights in Kyoto", [TOKYO, KYOTO, unscheduled], DURATION, WINDOWS
    )
    assert isinstance(split, SplitQuestion)
    assert "Osaka" in split.text


def test_split_shorter_than_the_recorded_minimum_asks_one_question():
    split = plan_route_split(
        "1 night in Tokyo and 1 night in Kyoto", [TOKYO, KYOTO], DURATION, WINDOWS
    )
    assert isinstance(split, SplitQuestion)
    assert split.text.count("?") == 1


def test_split_that_runs_past_the_saved_travel_window_asks_one_question():
    window = [{**WINDOWS[0], "endDate": "2030-05-10"}]
    split = plan_route_split(
        "6 nights in Tokyo and 4 nights in Kyoto", [TOKYO, KYOTO], LONG_TRIP, window
    )
    assert isinstance(split, SplitQuestion)
    assert "travel window" in split.text
