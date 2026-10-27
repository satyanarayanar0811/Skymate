from app.intent_engine import detect_intent, extract_entities

def test_booking_intent():
    assert detect_intent("I need a flight from Bangalore to Delhi tomorrow") == "book_flight"

def test_status_intent():
    assert detect_intent("Check AI234 status") == "flight_status"

def test_entity_extraction():
    e = extract_entities("Book a flight from Bangalore to Delhi on 2026-11-02 for 2 passengers")
    assert e["departure_city"].lower() == "bangalore"
    assert e["arrival_city"].lower() == "delhi"
    assert e["date"] == "2026-11-02"
    assert e["passengers"] == 2

def test_cancel_request_does_not_extract_destination():
    message = "I want to cancel my ticket"
    assert detect_intent(message) == "cancel_booking"
    assert "arrival_city" not in extract_entities(message)

def test_travel_tomorrow_does_not_extract_travel_as_city():
    entities = extract_entities("I want to travel tomorrow")
    assert "date" in entities
    assert "arrival_city" not in entities

def test_word_passenger_count():
    assert extract_entities("Two passengers")["passengers"] == 2

def test_trip_type_extraction():
    assert extract_entities("Round trip")["trip_type"] == "round_trip"
    assert extract_entities("One-way")["trip_type"] == "one_way"

def test_booking_status_intent():
    assert detect_intent("What is my booking status?") == "booking_status"
