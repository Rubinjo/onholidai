from onholidai_agent.graph.route_suggestion import (
    intercity_legs,
    nearby_place_suggestions,
    proposal_suggestions,
    route_sequence,
    shorter_circuit,
    stay_recommendations,
)


def place(name: str, latitude: float, longitude: float) -> dict[str, object]:
    return {"name": name, "location": {"latitude": latitude, "longitude": longitude}}


def stop(
    name: str, nights: int, arrival: str, departure: str, latitude: float, longitude: float
) -> dict[str, object]:
    return {
        **place(name, latitude, longitude),
        "plannedNights": nights,
        "arrivalDate": arrival,
        "departureDate": departure,
    }


ORIGIN = place("Amsterdam", 52.37, 4.9)
PARIS = stop("Paris", 2, "2030-05-01", "2030-05-03", 48.86, 2.35)
LYON = stop("Lyon", 2, "2030-05-03", "2030-05-05", 45.76, 4.84)
TOKYO = stop("Tokyo", 4, "2030-05-01", "2030-05-05", 35.68, 139.69)


def stay(name: str, start: str, end: str) -> dict[str, object]:
    return {
        "type": "accommodation",
        "provider": "nuitee",
        "serviceStart": start,
        "serviceEnd": end,
        "planningDetails": {"locationName": name},
    }


def test_route_sequence_names_the_origin_cities_nights_and_return():
    assert route_sequence([PARIS, LYON], ORIGIN) == (
        "Amsterdam → Paris (2 nights) → Lyon (2 nights) → back to Amsterdam"
    )


def test_route_sequence_works_without_a_named_origin():
    assert route_sequence([PARIS], None) == (
        "your confirmed origin → Paris (2 nights) → back to your confirmed origin"
    )


def test_intercity_legs_recommend_a_mode_for_each_change_of_base():
    legs = intercity_legs([PARIS, LYON], ORIGIN)
    assert [leg.split(":")[0] for leg in legs] == [
        "Amsterdam → Paris",
        "Paris → Lyon",
        "Lyon → Amsterdam",
    ]
    assert "rail" in legs[1]
    assert "Not supported yet: train/car search and booking" in legs[1]
    assert "excluded from the estimate" in legs[1]
    assert all("unverified estimate" in leg for leg in legs)


def test_multi_stop_advice_does_not_claim_the_cheapest_whole_trip_from_flight_prices():
    advice = proposal_suggestions([PARIS, LYON], [], ORIGIN)
    assert any("Lowest flight fare does not" in line for line in advice)
    assert any("return to the arrival city remain unpriced" in line for line in advice)


def test_intercity_legs_scale_the_recommendation_with_distance():
    assert "a flight" in intercity_legs([TOKYO], ORIGIN)[0]
    assert "rail" in intercity_legs([PARIS], ORIGIN)[0]


def test_a_single_stop_does_not_repeat_the_return_leg():
    assert [leg.split(":")[0] for leg in intercity_legs([PARIS], ORIGIN)] == ["Amsterdam → Paris"]


def test_intercity_legs_admit_missing_geography_instead_of_guessing():
    legs = intercity_legs([{"name": "Unknown"}], {"name": "Unlocated"})
    assert legs == [
        "Unlocated → Unknown: transport mode, duration and cost remain unverified "
        "because a location is missing."
    ]


def test_stay_recommendations_name_only_the_selected_stay_for_each_city():
    stays = stay_recommendations(
        [PARIS, LYON],
        [stay("Hotel Lumiere", "2030-05-01", "2030-05-03")],
    )
    assert stays[0] == (
        "Hotel Lumiere in Paris for 2 nights (nuitee, estimated; terms and availability "
        "unverified)."
    )
    assert stays[1] == (
        "No sourced stay covers Lyon; accommodation there remains unresolved and unpriced."
    )


def test_stay_recommendations_never_reuse_one_stay_for_two_cities():
    stays = stay_recommendations(
        [PARIS, LYON],
        [stay("Hotel Lumiere", "2030-05-01", "2030-05-05")],
    )
    assert "Hotel Lumiere in Paris" in stays[0]
    assert "No sourced stay covers Lyon" in stays[1]


def test_shorter_circuit_offers_advice_without_changing_the_saved_order():
    supplies = [
        stop("Coast", 2, "2030-05-01", "2030-05-03", 0, 20),
        stop("Alpha", 1, "2030-05-03", "2030-05-04", 0, 0),
        stop("Bay", 1, "2030-05-04", "2030-05-05", 0, 10),
    ]
    advice = shorter_circuit(
        supplies, [{"name": "Home", "location": {"latitude": 0, "longitude": 0}}]
    )
    assert advice is not None
    assert "A shorter circuit would visit" in advice
    assert all(city in advice for city in ("Coast", "Alpha", "Bay"))
    assert not advice.startswith("A shorter circuit would visit Coast → Alpha → Bay")
    assert "Your saved order stays" in advice
    assert [entry["name"] for entry in supplies] == ["Coast", "Alpha", "Bay"]


def test_shorter_circuit_stays_quiet_when_the_order_is_already_short():
    ordered: list[dict[str, object]] = [
        {"name": "Alpha", "location": {"latitude": 0, "longitude": 0}}
    ]
    assert (
        shorter_circuit(ordered, [{"name": "Home", "location": {"latitude": 0, "longitude": 0}}])
        is None
    )


def test_nearby_places_are_offered_with_attribution_and_never_priced():
    suggestions = nearby_place_suggestions(
        [{"text": "Consider Giverny as an extra base.", "sourceUrl": "https://example.com/x"}]
    )
    assert len(suggestions) == 1
    assert "unverified research" in suggestions[0]
    assert "https://example.com/x" in suggestions[0]
    assert "not priced or added" in suggestions[0]


def test_nearby_places_require_attribution():
    assert nearby_place_suggestions([{"text": "A place without a source."}]) == []


def test_proposal_suggestions_cover_route_stays_and_transport():
    lines = proposal_suggestions(
        [PARIS, LYON],
        [stay("Hotel Lumiere", "2030-05-01", "2030-05-03")],
        ORIGIN,
        research_facts=[{"text": "Giverny is nearby.", "sourceUrl": "https://example.com/y"}],
    )
    joined = " ".join(lines)
    assert "Hotel Lumiere in Paris" in joined
    assert "No sourced stay covers Lyon" in joined
    assert "Paris → Lyon" in joined
    assert "Giverny" in joined
    assert all(len(line) <= 500 for line in lines)
