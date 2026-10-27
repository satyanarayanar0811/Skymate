import pytest
from app.intent_engine import detect_intent, extract_entities

@pytest.mark.parametrize(('message','expected'), [
 ('Hi','greeting'),('Hello there','greeting'),('Hey SkyMate','greeting'),('Vanakkam','greeting'),
 ('I need a flight from Bangalore to Delhi tomorrow','book_flight'),('Book a ticket','book_flight'),('Find flights to Mumbai','book_flight'),('I want to fly next Friday','book_flight'),
 ('Check AI234 status','flight_status'),('Is my flight delayed?','flight_status'),('Is the flight on time?','flight_status'),('Status of QP123','flight_status'),
 ('Cancel my booking','cancel_booking'),('I want to cancel the ticket','cancel_booking'),('Please cancel reservation','cancel_booking'),('Cancel booking SKY-A1B2C3','cancel_booking'),
 ('Change my flight','modify_booking'),('Modify reservation','modify_booking'),('Reschedule my ticket','modify_booking'),('Can I change the travel date?','modify_booking'),
 ('Where is my refund?','refund'),('Refund status please','refund'),('Money back for booking','refund'),('How long for a refund','refund'),
 ('I need web check-in','checkin'),('Get my boarding pass','checkin'),('Check in for my flight','checkin'),('Online check-in help','checkin'),
 ('What is baggage allowance?','baggage'),('How many bags can I carry?','baggage'),('Luggage rules','baggage'),('Checked baggage weight','baggage'),
 ('Compare fares','fare_comparison'),('Show cheapest flight','book_flight'),('Business class ticket','book_flight'),('Book a round trip','book_flight'),
 ('I need a human agent','help'),('Connect me to support','help'),('Talk to a representative','help'),('I need help','help'),
 ('What is the cancellation policy?','faq'),('Tell me travel policy','faq'),('What documents do I need?','faq'),('What are the airport rules?','faq'),
 ('Tell me a joke','out_of_scope'),('Write me a poem','out_of_scope'),('Give me a recipe','out_of_scope'),('Diagnose my illness','out_of_scope'),
])
def test_intent_examples(message, expected):
    assert detect_intent(message) == expected

@pytest.mark.parametrize(('message','key','expected'), [
 ('I need a flight from Bangalore to Delhi tomorrow','departure_city','Bangalore'),
 ('Find a flight from Chennai to Mumbai on 2026-11-02','departure_city','Chennai'),
 ('Travel from Hyderabad to Delhi next Friday','arrival_city','Delhi'),
 ('Book from Coimbatore to Bengaluru','departure_city','Coimbatore'),
 ('I want to go to Singapore tomorrow','arrival_city','Singapore'),
 ('Check AI234 status','flight_no','AI234'),
 ('Cancel booking SKY-A1B2C3','booking_ref','SKY-A1B2C3'),
 ('Book for 2 passengers','passengers',2),
 ('I need 3 travellers','passengers',3),
 ('Book business class from Delhi to Mumbai','cabin_class','business'),
 ('Book economy from Delhi to Mumbai','cabin_class','economy'),
 ('Travel tomorrow','date',None),
])

def test_entity_examples(message, key, expected):
    entities=extract_entities(message)
    assert key in entities
    if expected is not None:
        assert entities[key] == expected


@pytest.mark.parametrize(
    ("message", "expected"),
    [
        (
            "Return the 5 cheapest offers",
            5,
        ),
        (
            "Show me 10 flight options",
            10,
        ),
        (
            "List 3 flights",
            3,
        ),
        (
            "Provide the 5 cheapest business class offers",
            5,
        ),
    ],
)
def test_result_count_extraction(message, expected):
    entities = extract_entities(message)
    assert entities["result_count"] == expected
