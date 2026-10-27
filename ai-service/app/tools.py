
import os
import httpx

BACKEND_URL = os.getenv(
    "BOOKING_BACKEND_URL",
    "http://localhost:4000/api"
).rstrip("/")

CODES = {
    "bengaluru": "BLR",
    "bangalore": "BLR",
    "blr": "BLR",
    "delhi": "DEL",
    "new delhi": "DEL",
    "del": "DEL",
    "chennai": "MAA",
    "maa": "MAA",
    "mumbai": "BOM",
    "bom": "BOM",
    "hyderabad": "HYD",
    "hyd": "HYD",
    "kolkata": "CCU",
    "goa": "GOI",
    "kochi": "COK",
    "pune": "PNQ",
    "ahmedabad": "AMD",
}


def airport_code(city: str) -> str:
    return CODES.get(
        city.strip().lower(),
        city.strip().upper()[:3]
    )


async def search_flights(
    departure_city: str,
    arrival_city: str,
    date: str,
    passengers: int = 1,
    cabin_class: str = "economy",
) -> dict:
    """Search flight offers using the configured airline provider."""

    params = {
        "origin": airport_code(departure_city),
        "destination": airport_code(arrival_city),
        "date": date,
        "adults": passengers,
        "cabin": cabin_class,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(
            f"{BACKEND_URL}/integrations/flights/search",
            params=params,
        )
        response.raise_for_status()
        return response.json()


async def flight_status(flight_no: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{BACKEND_URL}/status/{flight_no}"
        )
        response.raise_for_status()
        return response.json()


async def cancel_booking(booking_ref: str) -> dict:
    """Cancel a demo booking by its reference through the backend API."""
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.post(
            f"{BACKEND_URL}/bookings/{booking_ref.strip().upper()}/cancel"
        )
        response.raise_for_status()
        return response.json()


async def create_support_ticket(
    message: str,
    email: str = "",
) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            f"{BACKEND_URL}/support",
            json={
                "message": message,
                "email": email,
            },
        )
        response.raise_for_status()
        return response.json()


async def search_policy(query: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            f"{BACKEND_URL}/policy/search",
            params={"q": query[:250]},
        )
        response.raise_for_status()
        return response.json()
