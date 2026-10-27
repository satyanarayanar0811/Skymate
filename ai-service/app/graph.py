import os
import logging
import math
import re
from datetime import date
from typing import Any, TypedDict

from langgraph.graph import StateGraph, END

from .tools import (
    search_flights,
    flight_status,
    create_support_ticket,
    search_policy,
    cancel_booking as cancel_reservation,
)
from .intent_engine import detect_intent, extract_entities, normalize_message


GBP_TO_INR_RATE = float(os.getenv("GBP_TO_INR_RATE", "115"))
logger = logging.getLogger("skymate.ai.graph")


class AgentState(TypedDict, total=False):
    conversation_id: str
    message: str
    intent: str
    entities: dict[str, Any]
    reply: str
    next_action: str
    tool_result: dict[str, Any]
    history: list[dict[str, str]]
    context: dict[str, Any]


def format_display_fare(offer: dict[str, Any]) -> tuple[str, str]:
    """Return a display fare and currency without changing the source offer."""
    total = offer.get("total", offer.get("price", "unavailable"))
    currency = str(offer.get("currency", "")).upper()

    try:
        amount = float(total)
    except (TypeError, ValueError):
        return str(total), currency

    if currency == "GBP":
        converted = amount * GBP_TO_INR_RATE
        return f"₹{converted:,.2f} (estimated)", "INR"

    if currency == "INR":
        return f"₹{amount:,.2f}", "INR"

    return f"{currency} {amount:,.2f}".strip(), currency


def _offer_amount(offer: dict[str, Any]) -> float | None:
    """Read a numeric total/price, returning None for invalid fares."""
    raw = offer.get("total", offer.get("price"))
    try:
        amount = float(raw)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(amount) or amount < 0:
        return None
    return amount


def _fare_sort_key(offer: dict[str, Any]) -> tuple[int, float]:
    """Sort INR and estimated GBP fares together; put unknown currencies last."""
    currency = str(offer.get("currency", "")).strip().upper()
    amount = _offer_amount(offer)
    if amount is None:
        return (2, float("inf"))
    if currency == "INR":
        return (0, amount)
    if currency == "GBP":
        return (0, amount * GBP_TO_INR_RATE)
    return (1, amount)


def _deduplicate_offers(offers: list[Any]) -> list[dict[str, Any]]:
    """Drop exact duplicate offer records without collapsing distinct fares."""
    unique: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()

    for offer in offers:
        if not isinstance(offer, dict):
            continue
        amount = _offer_amount(offer)
        currency = str(offer.get("currency", "")).strip().upper()
        cabin = str(offer.get("cabinClass") or offer.get("cabin_class") or "").strip().lower()
        # Prefer provider offer ID when present; otherwise compare flight details,
        # cabin, currency and exact fare. Different fares for the same flight stay.
        provider_id = str(offer.get("id", "")).strip()
        if provider_id:
            key = ("id", provider_id)
        else:
            key = (
                str(offer.get("airline", "")).strip().casefold(),
                str(offer.get("flightNumber", offer.get("flightNo", ""))).strip().casefold(),
                str(offer.get("departureAirport", offer.get("origin", ""))).strip().upper(),
                str(offer.get("arrivalAirport", offer.get("destination", ""))).strip().upper(),
                str(offer.get("departureAt", offer.get("departure_at", ""))).strip(),
                str(offer.get("arrivalAt", offer.get("arrival_at", ""))).strip(),
                cabin,
                currency,
                round(amount, 2) if amount is not None else str(offer.get("total", offer.get("price", ""))),
                str(offer.get("stops", "")).strip(),
            )
        if key in seen:
            continue
        seen.add(key)
        unique.append(offer)
    return unique


def _display_cabin(value: Any) -> str:
    """Convert a cabin-class identifier into a readable label."""
    raw = str(value or "").strip().lower().replace("-", "_")
    labels = {
        "economy": "Economy",
        "premium_economy": "Premium Economy",
        "business": "Business",
        "first": "First",
        "first_class": "First",
    }
    return labels.get(raw, str(value or "Not provided"))


def _passenger_template(count: int) -> str:
    """Build the passenger form for the current passenger count."""
    return "\n\n".join(
        f"Passenger {i}:\n"
        "Full name (as on government ID):\n"
        "Age:\n"
        "Gender (if required by airline):\n"
        "Email address (booking contact):\n"
        "Mobile / WhatsApp number (with country code):"
        for i in range(1, count + 1)
    )


def _passenger_template_reply(count: int, updated: bool = False) -> str:
    """Return a passenger form, optionally explaining that it was updated."""
    if updated:
        prefix = (
            f"I've updated the booking to {count} passenger(s). "
            "Please use this revised template.\n\n"
        )
    else:
        prefix = (
            f"Please fill in this template for all {count} passenger(s), then send it back. "
            "Use the full name exactly as shown on the travel ID. For a domestic flight, "
            "do not send passport or ID numbers unless the airline specifically requires them.\n\n"
        )
    return (
        prefix
        + _passenger_template(count)
        + "\n\nI’ll review the details with you before any booking or payment."
    )


def _parse_passenger_details(text: str, expected_count: int) -> tuple[list[dict[str, str]], list[str]]:
    """Read the labeled passenger form and report required fields that are missing."""
    blocks: dict[int, list[str]] = {}
    current = None
    for line in text.splitlines():
        match = re.match(r"\s*Passenger\s+(\d+)\s*:\s*", line, re.IGNORECASE)
        if match:
            current = int(match.group(1))
            blocks[current] = []
        elif current is not None:
            blocks[current].append(line.strip())

    if not blocks and expected_count == 1:
        blocks[1] = text.splitlines()

    passengers: list[dict[str, str]] = []
    missing: list[str] = []
    labels = re.compile(
        r"(?P<label>full\s*name(?:\s*\([^)]*\))?|name|date\s+of\s+birth(?:\s+or\s+age)?|dob|age|"
        r"gender(?:\s*\([^)]*\))?|email(?:\s+address)?|mobile(?:\s*/\s*whatsapp)?(?:\s+number)?|"
        r"whatsapp(?:\s+number)?|phone(?:\s+number)?)\s*:",
        re.IGNORECASE,
    )
    for index in range(1, expected_count + 1):
        values = {"name": "", "birth": "", "gender": "", "email": "", "phone": ""}
        block_text = " ".join(blocks.get(index, []))
        matches = list(labels.finditer(block_text))
        for position, match in enumerate(matches):
            key = match.group("label").casefold()
            end = matches[position + 1].start() if position + 1 < len(matches) else len(block_text)
            value = block_text[match.end():end].strip(" \t\r\n,;|.")
            if key.startswith("full") or key == "name":
                values["name"] = value
            elif "date" in key or key in {"dob", "age"}:
                values["birth"] = value
            elif "gender" in key:
                values["gender"] = value
            elif "email" in key:
                values["email"] = value
            elif "mobile" in key or "whatsapp" in key or "phone" in key:
                values["phone"] = value

        label_prefix = f"Passenger {index}: "
        for key, label in (("name", "full name"), ("birth", "age"),
                           ("email", "booking email"), ("phone", "mobile with country code")):
            if not values[key]:
                missing.append(label_prefix + label)
        if values["email"] and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", values["email"]):
            missing.append(label_prefix + "valid booking email")
        phone_digits = re.sub(r"\D", "", values["phone"])
        if len(phone_digits) == 10 and not values["phone"].startswith("+"):
            values["phone"] = f"+91 {phone_digits}"
            phone_digits = "91" + phone_digits
        elif len(phone_digits) == 11 and phone_digits.startswith("0") and not values["phone"].startswith("+"):
            values["phone"] = f"+91 {phone_digits[1:]}"
            phone_digits = "91" + phone_digits[1:]
        if values["phone"] and (not values["phone"].startswith("+") or not 8 <= len(phone_digits) <= 15):
            missing.append(label_prefix + "mobile with country code (for example +91 9876543210)")
        if values["name"] and values["birth"] and values["email"] and values["phone"]:
            passengers.append(values)

    return passengers, missing


async def understand(state: AgentState) -> AgentState:
    message = state.get("message", "")

    prior_context = state.get("context", {}) or {}
    extracted = extract_entities(message)
    intent = detect_intent(message)

    # Recover the active route from the conversation if transient context was
    # lost between the assistant asking for a date and the user's reply.
    if not (prior_context.get("departure_city") and prior_context.get("arrival_city")):
        for previous in reversed(state.get("history", [])):
            if previous.get("role") != "user":
                continue
            previous_entities = extract_entities(str(previous.get("content", "")))
            if previous_entities.get("departure_city") and previous_entities.get("arrival_city"):
                prior_context = {
                    **prior_context,
                    "departure_city": previous_entities["departure_city"],
                    "arrival_city": previous_entities["arrival_city"],
                }
                break

    # A newly stated route starts a fresh search request. Do not silently reuse
    # a date, passenger count, or cabin from an older search in the same chat.
    
    has_new_route = bool(
        extracted.get("departure_city")
        and extracted.get("arrival_city")
        )
    if has_new_route:
    # A new route starts a completely fresh search and booking flow.
    # Do not carry forward the previous date, selected flight, or draft.
        prior_context = {}


    # A date/passenger/cabin/count-only follow-up continues an existing search.
    if (
        prior_context.get("departure_city")
        and prior_context.get("arrival_city")
        and any(
            key in extracted
            for key in ("date", "passengers", "cabin_class", "result_count")
        )
        and intent in {"faq", "book_flight", "show_flights", "fare_comparison"}
    ):
        intent = "book_flight"

    state["intent"] = intent
    state["entities"] = {**prior_context, **extracted}

    state.setdefault("history", [])
    state["history"] = (
        state["history"] + [{"role": "user", "content": message}]
    )[-12:]

    return state


async def route(state: AgentState) -> AgentState:
    intent = state.get("intent", "faq")
    entities = state.get("entities", {})
    message = state.get("message", "").strip()

    # Stateful conversational booking flow. State is persisted by main.py in Redis context.
    booking = entities.get("booking_flow") if isinstance(entities.get("booking_flow"), dict) else {}
    selected = entities.get("selected_offer") if isinstance(entities.get("selected_offer"), dict) else {}
    normalized_message = normalize_message(message)
    lower = normalized_message.casefold()

    # Cancellation with a reference is an action request; route text in the same
    # message must not turn it into a new flight search.
    if intent == "cancel_booking":
        booking_ref = entities.get("booking_ref")
        if not booking_ref:
            state["reply"] = "Please provide the booking reference (for example SKY-ABC123) so I can find the reservation."
            state["next_action"] = "cancel_booking"
            return state
        try:
            result = await cancel_reservation(str(booking_ref))
            state["tool_result"] = result
            state["reply"] = result.get("message", f"Booking {booking_ref} was cancelled.")
        except Exception as exc:
            logger.warning("Booking cancellation failed (%s)", type(exc).__name__)
            state["reply"] = (
                f"I couldn't cancel booking {booking_ref}. Please check the reference "
                "in the Booking management panel and try again."
            )
        state["next_action"] = "cancel_booking"
        return state

    proceed_words = {
        "proceed", "continue", "yes", "yeah", "yep", "okay", "ok", "sure",
        "proceed to payment", "confirm", "confirmed", "looks good", "all good",
        "go ahead", "do it", "book it", "pay",
    }
    flight_match = re.search(r"\b(?:proceed with|book|select)\s+(?:the\s+)?(.+?)\s*$", normalized_message, re.I)
    selection_ack = bool(re.search(
        r"\b(?:okay|ok|fine|good|works for me|sounds good|go with|go ahead with|let(?:'|’)s go with)\b",
        lower,
    ))
    if not booking and selected and (flight_match or lower in proceed_words or selection_ack):
        booking = {
            "stage": "cabin",
            "selected_offer": selected,
            "passengers": max(1, min(9, int(entities.get("passengers", 1)))),
        }
        entities["booking_flow"] = booking
        state["entities"] = entities
        state["reply"] = (
            f"Okay, {selected.get('airline', 'your selected airline')} "
            f"{selected.get('flightNumber', selected.get('flightNo', ''))} is selected. "
            "Please select your cabin class: Economy, Premium Economy, Business, or First Class."
        )
        state["next_action"] = "booking_cabin"
        return state

    if booking:
        stage = booking.get("stage", "trip_type")
        offer = booking.get("selected_offer") or selected

        # A passenger-count correction takes priority over the current form/review.
        requested_count = extract_entities(message).get("passengers")
        if (
            requested_count is not None
            and stage in {"passenger_details", "review"}
            and int(requested_count) != int(booking.get("passengers", 1))
        ):
            count = max(1, min(9, int(requested_count)))
            booking["passengers"] = count
            # Discard old details so entries for removed passengers aren't retained.
            booking.pop("passenger_details_text", None)
            booking["stage"] = "passenger_details"
            entities["booking_flow"] = booking
            state["entities"] = entities
            state["reply"] = _passenger_template_reply(count, updated=True)
            state["next_action"] = "booking_passenger_details"
            return state
        if stage == "trip_type":
            if re.search(r"\b(round.?trip|return|two.?way)\b", lower):
                booking["trip_type"] = "round_trip"
            elif re.search(r"\b(one.?way|single|one way)\b", lower):
                booking["trip_type"] = "one_way"
            else:
                state["reply"] = "Got it. Would you like a one-way or round-trip journey?"
                state["next_action"] = "booking_trip_type"
                return state
            if booking["trip_type"] == "round_trip":
                booking["stage"] = "return_date"
                state["reply"] = "What date would you like to return? Please include the day, month, and year."
                state["next_action"] = "booking_return_date"
                entities["booking_flow"] = booking
                state["entities"] = entities
                return state
            booking["stage"] = "passengers"
            known_count = booking.get("passengers") or entities.get("passengers")
            if known_count:
                booking["passengers"] = max(1, min(9, int(known_count)))
                booking["stage"] = "passenger_details"
                state["reply"] = _passenger_template_reply(booking["passengers"])
                state["next_action"] = "booking_passenger_details"
            else:
                state["reply"] = "How many passengers will be travelling? Please enter a number from 1 to 9."
                state["next_action"] = "booking_passengers"
        elif stage == "return_date":
            return_date = extract_entities(message).get("date")
            if not return_date:
                state["reply"] = "I couldn't read that return date. Please enter it as DD-MM-YYYY, for example 15-11-2026."
                state["next_action"] = "booking_return_date"
                return state
            booking["return_date"] = return_date
            booking["stage"] = "passenger_details" if booking.get("passengers") else "passengers"
            if booking["stage"] == "passenger_details":
                state["reply"] = _passenger_template_reply(int(booking["passengers"]))
                state["next_action"] = "booking_passenger_details"
            else:
                state["reply"] = "How many passengers will be travelling? Please enter a number from 1 to 9."
                state["next_action"] = "booking_passengers"
        elif stage == "cabin":
            cabin = next((c for c in ("premium economy", "business", "first class", "first", "economy") if c in lower), None)
            if not cabin:
                state["reply"] = "Which cabin class would you prefer: Economy, Premium Economy, Business, or First Class?"
                state["next_action"] = "booking_cabin"
                return state
            booking["cabin_class"] = cabin.replace(" ", "_")
            booking["stage"] = "trip_type"
            state["reply"] = f"Okay, {cabin.title()} is selected. Would you like a one-way or round-trip journey?"
            state["next_action"] = "booking_trip_type"
        elif stage == "passengers":
            m = re.search(r"\b([1-9])\b", lower)
            word_counts = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                           "six": 6, "seven": 7, "eight": 8, "nine": 9}
            count = int(m.group(1)) if m else next(
                (value for word, value in word_counts.items() if re.search(rf"\b{word}\b", lower)), None
            )
            if count is None:
                state["reply"] = "How many passengers will be travelling? Please enter a number from 1 to 9."
                state["next_action"] = "booking_passengers"
                return state
            booking["passengers"] = count
            count = booking["passengers"]
            if booking.get("trip_type") == "round_trip" and not booking.get("return_date"):
                booking["stage"] = "return_date"
                state["reply"] = "What date would you like to return? Please include the day, month, and year."
                state["next_action"] = "booking_return_date"
            else:
                booking["stage"] = "passenger_details"
                state["reply"] = _passenger_template_reply(count)
                state["next_action"] = "booking_passenger_details"
        elif stage == "passenger_details":
            passengers, missing = _parse_passenger_details(message, int(booking.get("passengers", 1)))
            if missing:
                state["reply"] = (
                    "I still need these passenger details:\n- "
                    + "\n- ".join(missing)
                    + "\n\nPlease complete the labeled passenger template."
                )
                state["next_action"] = "booking_passenger_details"
                return state
            booking["passengers_data"] = passengers
            booking["passenger_details_text"] = message
            booking["stage"] = "review"
            fare_display, _ = format_display_fare(offer)
            passenger_summary = "\n".join(
                line
                for index, passenger in enumerate(passengers, start=1)
                for line in (
                    f"Passenger {index}:",
                    f"  Full name: {passenger['name']}",
                    f"  Age: {passenger['birth']}",
                    *([f"  Gender: {passenger['gender']}"] if passenger.get("gender") else []),
                    f"  Email: {passenger['email']}",
                    f"  Mobile: {passenger['phone']}",
                )
            )
            state["reply"] = ("Please review your booking draft:\n"
                f"Flight: {offer.get('airline', 'Airline')} {offer.get('flightNumber', offer.get('flightNo', ''))}\n"
                f"Route: {offer.get('departureAirport', offer.get('origin', ''))} to {offer.get('arrivalAirport', offer.get('destination', ''))}\n"
                f"Trip: {booking.get('trip_type', 'not specified').replace('_', ' ').title()}\n"
                f"Return date: {booking.get('return_date', 'Not applicable')}\n"
                f"Cabin: {booking.get('cabin_class', '').replace('_', ' ').title()}\n"
                f"Passengers: {booking.get('passengers', 1)}\nPassenger details:\n{passenger_summary}\n"
                f"Estimated fare: {fare_display} (must be revalidated)\n\n"
                "If everything is correct, type Proceed. To change something, tell me what to update. No booking or payment has been made yet.")
        elif stage == "review":
            if lower in proceed_words or re.search(
                r"\b(?:proceed|pay|payment|confirm|confirmed|okay|ok|sure|go ahead|go with it|looks good|all good|do it|book it|yes|yeah|yep)\b",
                lower,
            ):
                booking["stage"] = "payment_pending"
                state["reply"] = "Your details are confirmed. Opening the mock payment gateway now."
                state["next_action"] = "booking_payment"
            else:
                state["reply"] = "What would you like to change in the booking draft? You can update the trip type, cabin class, passenger count, or passenger details."
        else:
            state["reply"] = "Your booking draft is saved in this conversation. A live checkout is not connected yet, so no payment has been taken."
        entities["booking_flow"] = booking
        state["entities"] = entities
        state["next_action"] = state.get("next_action", "booking_" + booking.get("stage", "review"))
        return state

    if intent == "show_flights":
        state["reply"] = (
            "I can show the flights from your latest search. "
            "If they are not visible, please repeat the route and travel date."
        )
        state["next_action"] = "show_flights"
        return state

    if intent == "continue_booking":
        state["reply"] = (
            "Your selected flight can be reviewed in the Travel Workspace. "
            "Check the fare and passenger details before continuing. "
            "No reservation is confirmed until the booking provider confirms it."
        )
        state["next_action"] = "continue_booking"
        return state

    # Flight search.
    if intent in {"book_flight", "fare_comparison"}:
        departure_city = entities.get("departure_city")
        arrival_city = entities.get("arrival_city")

        if not departure_city or not arrival_city:
            state["reply"] = (
                "I'd be happy to help you find a flight. "
                "Please provide your departure city and destination, "
                "along with your travel date, passenger count and cabin class."
            )
            state["next_action"] = "collect_search_details"
            return state

        travel_date = entities.get("date")
        passengers = entities.get("passengers", 1)
        cabin_class = entities.get("cabin_class", "economy")
        result_count = entities.get("result_count", 5)

        try:
            result_count = max(1, min(20, int(result_count)))
        except (TypeError, ValueError):
            result_count = 5

        if not travel_date:
            greeting = (
                "Hello! "
                if re.search(
                    r"^\s*(hi|hello|hey|vanakkam)\b",
                    message,
                    re.IGNORECASE,
                )
                else ""
            )
            state["reply"] = (
                f"{greeting}I can help you find flights from {departure_city} "
                f"to {arrival_city}. What date would you like to travel?"
            )
            state["next_action"] = "collect_search_details"
            return state

        # Validate dates before making any provider request.
        try:
            parsed_travel_date = date.fromisoformat(str(travel_date))
        except (TypeError, ValueError):
            state["reply"] = (
                "Please provide a valid travel date, for example 15 November 2026."
            )
            state["next_action"] = "collect_search_details"
            return state

        if parsed_travel_date <= date.today():
            state["reply"] = (
                "That travel date must be in the future. Please provide another date."
            )
            state["next_action"] = "collect_search_details"
            return state

        if departure_city.strip().casefold() == arrival_city.strip().casefold():
            state["reply"] = (
                "Your departure city and destination are the same. "
                "Please provide two different cities."
            )
            state["next_action"] = "collect_search_details"
            return state

        try:
            result = await search_flights(
                departure_city,
                arrival_city,
                travel_date,
                passengers,
                cabin_class,
            )

            offers = result.get("offers", []) or []
            unique_offers = _deduplicate_offers(offers)

            if not unique_offers:
                state["tool_result"] = {
                    **result,
                    "offers": [],
                    "totalOffers": 0,
                    "requestedResultCount": result_count,
                }
                state["reply"] = (
                    "No valid flight offers were returned for this search. "
                    "Please check your route and travel date, or try another search."
                )
            else:
                sorted_offers = sorted(unique_offers, key=_fare_sort_key)
                selected_offers = sorted_offers[:result_count]

                state["tool_result"] = {
                    **result,
                    "offers": selected_offers,
                    "totalOffers": len(unique_offers),
                    "requestedResultCount": result_count,
                }

                lines = [
                    f"I found {len(unique_offers)} unique flight offers from "
                    f"{departure_city} to {arrival_city}.",
                    f"Here are the {len(selected_offers)} lowest-priced offers "
                    "among the offers returned by the provider:",
                ]

                for index, offer in enumerate(selected_offers, start=1):
                    display_fare, _ = format_display_fare(offer)
                    airline = offer.get("airline") or "Unknown airline"
                    flight_number = offer.get("flightNumber") or offer.get("flightNo") or "Not provided"
                    departure_at = offer.get("departureAt") or offer.get("departure_at") or "Not provided"
                    arrival_at = offer.get("arrivalAt") or offer.get("arrival_at") or ""
                    origin = offer.get("departureAirport") or offer.get("origin") or ""
                    destination = offer.get("arrivalAirport") or offer.get("destination") or ""
                    stops = offer.get("stops")

                    # Do not infer a cabin from the request; only report provider data.
                    offer_cabin = offer.get("cabinClass") or offer.get("cabin_class")
                    cabin_label = (
                        _display_cabin(offer_cabin)
                        if offer_cabin
                        else "Cabin not specified by provider"
                    )

                    details = (
                        f"{index}. {airline} {flight_number} — "
                        f"{cabin_label} — {display_fare} — "
                        f"Departure: {departure_at}"
                    )
                    if arrival_at:
                        details += f" — Arrival: {arrival_at}"
                    if origin and destination:
                        details += f" — Route: {origin} to {destination}"
                    if stops is not None:
                        details += f" — Stops: {stops}"
                    lines.append(details)

                if len(unique_offers) > len(selected_offers):
                    lines.append(
                        f"Showing {len(selected_offers)} of {len(unique_offers)} unique offers returned."
                    )

                if any(
                    str(offer.get("currency", "")).strip().upper() not in {"INR", "GBP"}
                    for offer in unique_offers
                ):
                    lines.append(
                        "Note: fares in unsupported currencies cannot be reliably compared "
                        "with INR/GBP fares and are listed after comparable fares."
                    )

                lines.append(
                    "These are provider-returned offers, not a confirmed booking. "
                    "Fare and availability may change."
                )
                state["reply"] = "\n".join(lines)

        except Exception as exc:
            logger.warning("Flight search failed (%s)", type(exc).__name__)
            state["reply"] = (
                "The flight-search service could not complete your request. "
                "Please try again shortly."
            )

        state["next_action"] = "show_flights"
        return state

    # Flight status.
    if intent == "flight_status":
        flight_no = entities.get("flight_no")

        if not flight_no:
            state["reply"] = "Please provide a flight number, for example AI234."
        else:
            try:
                result = await flight_status(flight_no)
                state["tool_result"] = result
                state["reply"] = (
                    f"{flight_no} status: {result.get('status', 'Unknown')}. "
                    "Flight status information depends on the operating airline and may change."
                )
            except Exception as exc:
                logger.warning("Flight status lookup failed (%s)", type(exc).__name__)
                state["reply"] = (
                    "That flight could not be found in the available status service. "
                    "Please verify its status with the airline."
                )

        state["next_action"] = "show_status"
        return state

    # Customer support.
    if intent == "help":
        try:
            result = await create_support_ticket(message)
            state["tool_result"] = result
            ticket = result.get("ticket", {}).get("id", "created")
            state["reply"] = (
                f"Support ticket {ticket} was created. "
                "A support representative has not yet been contacted."
            )
        except Exception as exc:
            logger.warning("Support ticket creation failed (%s)", type(exc).__name__)
            state["reply"] = (
                "I can help with flight searches, booking guidance, "
                "flight status, baggage, refunds and check-in."
            )

        state["next_action"] = "support"
        return state

    # General responses.
    templates = {
        "greeting": (
            "Welcome to SkyMate! I can help search flights, compare fares, "
            "check status, explain baggage guidance or help with a reservation."
        ),
        "cancel_booking": (
            "Enter your SkyMate booking reference in the booking panel and review "
            "the booking before confirming cancellation."
        ),
        "refund": (
            "Please provide your SkyMate booking reference. Refund status depends on "
            "the payment provider and the reservation's recorded payment state."
        ),
        "checkin": (
            "Enter your booking reference in the booking panel to check whether "
            "online check-in is available for your itinerary."
        ),
        "baggage": (
            "Baggage allowance depends on the airline, route and fare. "
            "Verify the exact allowance with the operating airline."
        ),
        "modify_booking": (
            "Flight changes require provider support. The system must validate "
            "fare rules, availability and fees before confirming changes."
        ),
        "fare_comparison": (
            "I can compare the available flight offers by displayed fare. "
            "Search for a route to review the returned offers."
        ),
        "faq": (
            "I can help with flight search, booking, flight status, baggage, "
            "cancellation, refunds, check-in or customer support."
        ),
        "out_of_scope": (
            "I'm designed to help with airline-related tasks such as flight search, "
            "booking guidance, baggage and flight status."
        ),
    }

    state["reply"] = templates.get(intent, templates["faq"])

    # Policy retrieval.
    if intent in {
        "faq",
        "baggage",
        "refund",
        "cancel_booking",
        "checkin",
        "modify_booking",
    }:
        try:
            retrieved = await search_policy(message)
            documents = retrieved.get("documents", [])

            if documents:
                state["tool_result"] = {"policy_documents": documents[:4]}
                state["reply"] = (
                    "Based on the available policy information:\n"
                    + "\n\n".join(
                        f"{doc.get('title', 'Policy')}: {doc.get('content', '')}"
                        for doc in documents[:3]
                    )
                    + "\n\nPolicy details can vary by airline, route and fare. Confirm the applicable rules with the operating airline."
                )
            else:
                state["reply"] = (
                    "I could not find a matching policy document in the SkyMate library. "
                    "Please contact support for a verified answer."
                )

        except Exception as exc:
            logger.warning("Policy retrieval failed (%s)", type(exc).__name__)
            state["reply"] = (
                "The policy library is temporarily unavailable. "
                "Please contact support for a verified answer."
            )

    state["next_action"] = intent
    return state


async def grounded_response(state: AgentState) -> AgentState:
    # The graph's replies are already grounded in parsed state and tool results.
    # Rewriting them with an LLM can invent booking steps or passenger validation errors.
    return state


builder = StateGraph(AgentState)
builder.add_node("understand", understand)
builder.add_node("route", route)
builder.add_node("grounded_response", grounded_response)

builder.set_entry_point("understand")
builder.add_edge("understand", "route")
builder.add_edge("route", "grounded_response")
builder.add_edge("grounded_response", END)

agent_graph = builder.compile()
