from app.intent_engine import detect_intent, extract_entities


def test_common_typos_still_trigger_flight_search():
    message = "saerch fro filght between chenai to mumbaai"
    assert detect_intent(message) == "book_flight"
    entities = extract_entities(message)
    assert entities["departure_city"] == "Chennai"
    assert entities["arrival_city"] == "Mumbai"


def test_typo_tolerant_search_with_relative_date():
    message = "search fro filght between chenai to mumbaai tomorrow"
    assert detect_intent(message) == "book_flight"
    entities = extract_entities(message)
    assert entities["departure_city"] == "Chennai"
    assert entities["arrival_city"] == "Mumbai"
    assert "date" in entities


def test_followup_list_typo_is_recognized():
    assert detect_intent("listout those flights") == "show_flights"


def test_destination_only_does_not_invent_origin():
    entities = extract_entities("I want to go to Singapore tomorrow")
    assert "departure_city" not in entities
    assert entities["arrival_city"] == "Singapore"


def test_cancel_request_does_not_extract_fake_destination():
    entities = extract_entities("I want to cancel my ticket")
    assert "arrival_city" not in entities
    assert detect_intent("I want to cancel my ticket") == "cancel_booking"


def test_word_passenger_count_is_recognized():
    entities = extract_entities("Two passengers")
    assert entities["passengers"] == 2
