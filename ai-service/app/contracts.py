from typing import Any
from .tools import airport_code


def frontend_entity_contract(raw_entities: dict[str, Any]) -> dict[str, Any]:
    """Normalize the agent's snake_case entity keys to the frontend camelCase contract."""
    entities = {
        "departureCity": airport_code(str(raw_entities["departure_city"])) if raw_entities.get("departure_city") else None,
        "arrivalCity": airport_code(str(raw_entities["arrival_city"])) if raw_entities.get("arrival_city") else None,
        "date": raw_entities.get("date"),
        "returnDate": raw_entities.get("return_date"),
        "passengers": raw_entities.get("passengers"),
        "cabinClass": raw_entities.get("cabin_class"),
        "flightNo": raw_entities.get("flight_no"),
        "bookingRef": raw_entities.get("booking_ref"),
        "bookingFlow": raw_entities.get("booking_flow"),
    }
    return {key: value for key, value in entities.items() if value is not None}
