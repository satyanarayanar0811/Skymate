
import re
from datetime import date, datetime, timedelta
from difflib import get_close_matches
from typing import Any


CITY_NAMES = [
    "Chennai", "Mumbai", "Bengaluru", "Bangalore", "Delhi", "Hyderabad",
    "Kolkata", "Goa", "Kochi", "Pune", "Ahmedabad", "Coimbatore",
    "Singapore", "Dubai", "London", "New York", "Abu Dhabi", "Jaipur",
    "Lucknow", "Visakhapatnam", "Trichy", "Madurai", "Thiruvananthapuram",
]

CITY_ALIASES = {
    "madras": "Chennai",
    "bombay": "Mumbai",
    "new delhi": "Delhi",
    "blr": "Bengaluru",
    "maa": "Chennai",
    "bom": "Mumbai",
    "del": "Delhi",
}

TYPO_REPLACEMENTS = {
    r"\bprocees\b": "proceed",
    r"\bprocede\b": "proceed",
    r"\bprocced\b": "proceed",
    r"\blistout\b": "list out",
    r"\bsaerch\b": "search",
    r"\bserach\b": "search",
    r"\bsrch\b": "search",
    r"\bfro\b": "for",
    r"\bfilghts?\b": "flight",
    r"\bflihts?\b": "flight",
    r"\bchenai\b": "chennai",
    r"\bchenni\b": "chennai",
    r"\bmumbaai\b": "mumbai",
    r"\bmumbay\b": "mumbai",
    r"\bbanglore\b": "bangalore",
    r"\bbangluru\b": "bengaluru",
}


def normalize_message(message: str) -> str:
    """Normalize common typos and known city names."""
    text = message.strip()

    for pattern, replacement in TYPO_REPLACEMENTS.items():
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)

    for city in CITY_NAMES:
        if len(city.split()) != 1:
            continue

        def replace_word(match: re.Match[str]) -> str:
            word = match.group(0)
            if word.lower() == city.lower():
                return word

            match_city = get_close_matches(
                word.lower(), [city.lower()], n=1, cutoff=0.78
            )
            return city if match_city else word

        text = re.sub(
            r"\b[a-z]{3,}\b",
            replace_word,
            text,
            flags=re.IGNORECASE,
        )

    return re.sub(r"\s+", " ", text).strip()


def _canonical_city(value: str) -> str:
    cleaned = re.sub(
        r"^(?:the\s+)?(?:city\s+of\s+)",
        "",
        value.strip(),
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\b(?:please|pls|plz|for me|if possible|asap)\b.*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip(" ,.!?;:")

    alias = CITY_ALIASES.get(cleaned.lower())
    if alias:
        return alias

    for city in CITY_NAMES:
        if city.lower() == cleaned.lower():
            return city

    close = get_close_matches(
        cleaned.lower(),
        [city.lower() for city in CITY_NAMES],
        n=1,
        cutoff=0.78,
    )
    if close:
        return next(city for city in CITY_NAMES if city.lower() == close[0])

    return cleaned[:1].upper() + cleaned[1:] if cleaned else cleaned


def detect_intent(message: str) -> str:
    text = normalize_message(message).lower().strip()

    if re.search(r"\b(?:booking|reservation)\s+status\b|\bstatus\s+of\s+(?:my\s+)?(?:booking|reservation)\b", text):
        return "booking_status"

    if re.search(r"\b(cancel|cancellation)\b", text) and (
        re.search(r"\bSKY-[A-F0-9]{6}\b", text, re.IGNORECASE)
        or re.search(r"\b(ticket|booking|reservation)\b", text)
    ):
        return "cancel_booking"

    if re.search(r"\bshow\s+cheapest\s+flight\b", text):
        return "book_flight"

    if re.search(r"\b(?:from\s+.+?\s+to\s+|between\s+.+?\s+(?:and|to)\s+)", text):
        if re.search(
            r"\b(search|find|book|flight|flights|fly|ticket|tickets|travel|go|between)\b",
            text,
        ):
            if re.search(
                r"\b(list|show|display|provide|give|return)\b.*"
                r"\b(flights?|offers?|options|results|fares)\b",
                text,
            ):
                return "book_flight"
            return "book_flight"

    patterns = [
        ("out_of_scope", r"\b(joke|poem|recipe|write code|stock recommendation|medical diagnosis|diagnose my illness)\b"),
        ("flight_status", r"\b(flight status|check(?:\s+\w+){0,2}\s+status|status of (?:flight|[a-z]{1,3}\s?\d{2,4})|delayed|on time|departure status|arrival status)\b"),
        ("refund", r"\b(refund|money back)\b"),
        ("cancel_booking", r"\b(cancel|cancellation)\b(?!\s+policy)"),
        ("checkin", r"\b(check.?in|boarding pass)\b"),
        ("baggage", r"\b(baggage|luggage|bag allowance|bags?)\b"),
        ("modify_booking", r"\b(change|modify|reschedule)\b.*\b(booking|reservation|flight|ticket|date)\b"),
        ("show_flights", r"\b(list|show|display|provide|give|see|return)\b.*\b(flights?|offers?|options|results|fares)\b|\b(list out those flights|show those flights|flight list)\b"),
        ("fare_comparison", r"\b(compare fares?|fare comparison|lowest fare|best fare|compare flights?)\b"),
        ("continue_booking", r"\b(okay proceed|ok proceed|proceed|continue|continue booking|go ahead|select this flight|select it|choose it|book this one)\b"),
        ("book_flight", r"\b(book|booking|search|find|flight|flights|fly|ticket|tickets|between|cheapest)\b"),
        ("faq", r"\b(policy|travel documents|visa requirements|airport rules)\b"),
        ("help", r"\b(agent|human|support|help|representative)\b"),
        ("greeting", r"^(hi|hello|hey|vanakkam)\b"),
    ]

    for intent, pattern in patterns:
        if re.search(pattern, text):
            return intent

    return "faq"


def extract_entities(message: str) -> dict[str, Any]:
    entities: dict[str, Any] = {}
    text = normalize_message(message)
    lower = text.lower()

    # Extract a requested number of results, e.g. "5 cheapest offers".
    result_count_match = re.search(
        r"\b(?:top|first|show|return|give|list|display|provide)?\s*"
        r"(\d{1,2})\s+"
        r"(?:(?:cheapest|lowest|best|available|business|economy|premium)\s+)*"
        r"(?:class\s+)?(?:flight\s+)?(?:offers?|flights?|options|results|fares)\b",
        lower,
    )
    if result_count_match:
        entities["result_count"] = max(
            1, min(20, int(result_count_match.group(1)))
        )

    # Extract route.
    stop = (
        r"(?=\s+\b(?:on|for|tomorrow|today|next|coming|this|"
        r"day after tomorrow|with|in)\b|[,!?;.]|$)"
    )
    route_patterns = [
        rf"\bfrom\s+(.+?)\s+\bto\s+(.+?){stop}",
        rf"\bbetween\s+(.+?)\s+\b(?:and|to)\s+(.+?){stop}",
    ]

    route_match = None
    for pattern in route_patterns:
        route_match = re.search(pattern, text, re.IGNORECASE)
        if route_match:
            break

    if route_match:
        departure = route_match.group(1).strip()
        destination = route_match.group(2).strip()

        departure = re.sub(
            r"^(?:(?:i\s+)?(?:want|need|would like)\s+to\s+)?"
            r"(?:(?:search|find|book)\s+(?:me\s+)?(?:a\s+)?(?:flight|ticket)s?\s+)?"
            r"(?:flight\s+)?",
            "",
            departure,
            flags=re.IGNORECASE,
        ).strip()

        destination = re.sub(
            r"\s+\b(?:flight|ticket|for me|please)\b.*$",
            "",
            destination,
            flags=re.IGNORECASE,
        ).strip()

        departure = _canonical_city(departure)
        destination = _canonical_city(destination)

        if departure and destination and departure.lower() != destination.lower():
            entities["departure_city"] = departure
            entities["arrival_city"] = destination
    else:
        # Do not interpret infinitives such as "to cancel my ticket" or
        # "to change my booking" as a destination. Only accept a destination
        # phrase in a travel-related message.
        travel_context = re.search(r"\b(flight|flights|ticket|tickets|travel|fly|flying|go|trip|destination)\b", lower)
        non_destination = re.search(r"\bto\s+(?:cancel|change|modify|reschedule|refund|check|see|know|book|help|travel|fly|go)\b", lower)
        destination_matches = [] if (non_destination and not re.search(r"\b(?:flight|flights)\s+to\b", lower) and not re.search(r"\b(?:go|travel|fly|head)\s+to\s+[A-Za-z]", text, re.IGNORECASE)) else (
            list(re.finditer(
                r"\b(?:to|towards)\s+([A-Za-z][A-Za-z .'-]+?)"
                r"(?=\s+\b(?:on|for|tomorrow|today|next|coming|this|with|in)\b|[,!?;.]|$)",
                text, re.IGNORECASE,
            )) if travel_context else []
        )
        if destination_matches:
            destination = destination_matches[-1].group(1).strip()
            destination = re.sub(r"^(?:(?:go|travel|fly|head)\s+to\s+)", "", destination, flags=re.IGNORECASE)
            entities["arrival_city"] = _canonical_city(destination)

        origin_match = re.search(
            r"\bfrom\s+([A-Za-z][A-Za-z .'-]+?)"
            r"(?=\s+\b(?:on|for|tomorrow|today|next|coming|this|to)\b|[,!?;.]|$)",
            text,
            re.IGNORECASE,
        )
        if origin_match:
            entities["departure_city"] = _canonical_city(
                origin_match.group(1)
            )

    # Extract travel date.
    today = date.today()
    resolved_date = None

    if "day after tomorrow" in lower:
        resolved_date = today + timedelta(days=2)
    elif re.search(r"\btomorrow\b", lower):
        resolved_date = today + timedelta(days=1)
    elif re.search(r"\btoday\b", lower):
        resolved_date = today
    else:
        weekday_match = re.search(
            r"\b(?:(next|coming|this)\s+)?"
            r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
            lower,
        )

        if weekday_match:
            modifier, weekday_name = weekday_match.groups()
            weekdays = {
                "monday": 0, "tuesday": 1, "wednesday": 2,
                "thursday": 3, "friday": 4, "saturday": 5,
                "sunday": 6,
            }
            days_ahead = (weekdays[weekday_name] - today.weekday()) % 7

            if modifier == "next":
                days_ahead = days_ahead + 7 if days_ahead < 7 else 7
            elif modifier in {"coming", "this"} and days_ahead == 0:
                days_ahead = 7

            resolved_date = today + timedelta(days=days_ahead)
        else:
            iso_match = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", text)
            dmy_match = re.search(
                r"\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b",
                text,
            )

            try:
                if iso_match:
                    resolved_date = date.fromisoformat(iso_match.group(1))
                elif dmy_match:
                    day, month, year = map(int, dmy_match.groups())
                    resolved_date = date(year, month, day)
            except ValueError:
                resolved_date = None

            if resolved_date is None:
                written_patterns = (
                    r"\b\d{1,2}\s+[A-Za-z]+\s+20\d{2}\b",
                    r"\b[A-Za-z]+\s+\d{1,2},?\s+20\d{2}\b",
                )
                for pattern in written_patterns:
                    match = re.search(pattern, text, re.IGNORECASE)
                    if not match:
                        continue

                    candidate = match.group(0).replace(",", "")
                    for fmt in (
                        "%d %B %Y", "%d %b %Y",
                        "%B %d %Y", "%b %d %Y",
                    ):
                        try:
                            resolved_date = datetime.strptime(
                                candidate, fmt
                            ).date()
                            break
                        except ValueError:
                            continue

                    if resolved_date is not None:
                        break

    if resolved_date:
        entities["date"] = resolved_date.isoformat()

    # Extract trip type when explicitly stated.
    if re.search(r"\b(round.?trip|return trip|two.?way)\b", lower):
        entities["trip_type"] = "round_trip"
    elif re.search(r"\b(one.?way|single trip)\b", lower):
        entities["trip_type"] = "one_way"

    # Extract passenger count.
    passenger_match = re.search(
        r"\b(\d+)\s+(?:passengers?|people|travellers?|travelers?|adults?)\b",
        lower,
    )
    if passenger_match:
        entities["passengers"] = max(1, min(9, int(passenger_match.group(1))))
    else:
        word_counts = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
                       "six": 6, "seven": 7, "eight": 8, "nine": 9}
        word_count_match = re.search(
            r"\b(one|two|three|four|five|six|seven|eight|nine)\s+(?:passengers?|people|travellers?|travelers?|adults?)\b",
            lower,
        )
        if word_count_match:
            entities["passengers"] = word_counts[word_count_match.group(1)]

    # Extract cabin class.
    if re.search(r"\b(first class|first-class)\b", lower):
        entities["cabin_class"] = "first"
    elif re.search(r"\b(business class|business)\b", lower):
        entities["cabin_class"] = "business"
    elif re.search(r"\bpremium economy\b", lower):
        entities["cabin_class"] = "premium_economy"
    elif re.search(r"\beconomy\b", lower):
        entities["cabin_class"] = "economy"

    # Extract flight number.
    flight_match = re.search(
        r"\b([A-Z]{1,3}\s?\d{2,4})\b",
        text,
        re.IGNORECASE,
    )
    if flight_match:
        raw_candidate = re.sub(r"\s+", "", flight_match.group(1)).lower()
        if not re.fullmatch(r"(?:on|for|in)?20\d{2}", raw_candidate):
            entities["flight_no"] = raw_candidate.upper()

    # Extract booking reference.
    booking_match = re.search(
        r"\b(SKY-[A-F0-9]{6})\b",
        text,
        re.IGNORECASE,
    )
    if booking_match:
        entities["booking_ref"] = booking_match.group(1).upper()

    return entities
