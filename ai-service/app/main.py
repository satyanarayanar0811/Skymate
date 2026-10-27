from .intent_engine import extract_entities, normalize_message
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, PlainTextResponse
import json
import logging
import os
import re
import time
import uuid

from pydantic import BaseModel, Field
from redis.asyncio import Redis as AsyncRedis

from .graph import agent_graph
from .contracts import frontend_entity_contract

app = FastAPI(
    title="SkyMate Python AI Agent",
    version="1.0.0",
    description="FastAPI + LangGraph agent for the airline reservation chatbot.",
)

frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_origin],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Request-Id"],
)


class JsonFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({
            "level": record.levelname.lower(),
            "message": record.getMessage(),
            "logger": record.name,
        })


_handler = logging.StreamHandler()
_handler.setFormatter(JsonFormatter())

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    handlers=[_handler],
    force=True,
)

logger = logging.getLogger("skymate.ai")

redis_client = AsyncRedis.from_url(
    os.getenv("REDIS_URL", "redis://localhost:6379"),
    decode_responses=True,
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    started = time.monotonic()

    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "request_failed request_id=%s path=%s",
            request_id,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Internal server error",
                "request_id": request_id,
            },
        )

    response.headers["X-Request-Id"] = request_id

    logger.info(
        "request_complete request_id=%s method=%s path=%s status=%s duration_ms=%d",
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        int((time.monotonic() - started) * 1000),
    )

    return response


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    conversation_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        min_length=8,
        max_length=120,
    )
    trip_type: str | None = None
    passengers: int | None = Field(default=None, ge=1, le=9)


def asks_for_previous_flight_list(message: str) -> bool:
    """Identify follow-up requests for previously searched flight offers."""
    text = message.lower().strip()

    text = re.sub(r"\blistout\b", "list out", text)
    patterns = [
        r"\b(list|show|display|provide|give|find)\b.*\b(flights?|offers?|options|results|fares)\b",
        r"\b(can you|could you|please)\b.*\b(list|show|display|provide|give)\b.*\b(flights?|offers?|options|results|fares)\b",
        r"\bwhat are the flight options\b",
        r"\bshow me the flights\b",
        r"\blist out the flights\b",
        r"\bflight list\b",
        r"\b(those|these|previous|earlier) flights\b",
        r"\bcheapest\s+(?:top\s+)?\d+\b",
        r"\bcheapest\s+(one|two|three|four|five)\b",
        r"\b(second|third|fourth|first|last) flight\b",
        r"\b(select|choose)\s+(?:the\s+)?(?:first|second|third|fourth|last|\d+)(?:\s+(?:flight|one|option))?\b",
        r"\bwhat about the (?:first|second|third|fourth|last|\d+)(?: one| flight| option)?\b",
        r"\bselect it\b",
        r"\bchoose it\b",
    ]

    return any(re.search(pattern, text) for pattern in patterns)


def _ordinal_index(message: str) -> int | None:
    text = message.lower()
    for word, index in (("first", 0), ("second", 1), ("third", 2), ("fourth", 3), ("fifth", 4), ("last", -1)):
        if re.search(rf"\b{word}\b", text):
            return index
    match = re.search(r"\b(?:option|flight|number)?\s*(\d+)\b", text)
    return max(0, int(match.group(1)) - 1) if match else None


def _offer_price(offer: dict) -> float:
    try:
        return float(offer.get("total", float("inf")))
    except (TypeError, ValueError):
        return float("inf")


@app.get("/metrics", response_class=PlainTextResponse)
async def metrics():
    return (
        "# HELP skymate_ai_up AI service process status\n"
        "# TYPE skymate_ai_up gauge\n"
        "skymate_ai_up 1\n"
    )


@app.get("/health")
async def health():
    return {
        "ok": True,
        "service": "skymate-python-ai",
        "mode": "configured",
    }


@app.get("/ready")
async def ready():
    try:
        await redis_client.ping()
        return {
            "ok": True,
            "service": "skymate-python-ai",
            "redis": "ready",
        }
    except Exception:
        raise HTTPException(status_code=503, detail="Redis unavailable")


@app.post("/chat")
async def chat(request: ChatRequest):
    cid = request.conversation_id
    message = request.message.strip()

    try:
        # If the user asks for the previous flight list, reuse the
        # structured offers from this conversation instead of searching again.
        cached = await redis_client.get(f"flight_search:{cid}")
        if asks_for_previous_flight_list(message) and cached:
            previous_result = json.loads(cached)
            offers = previous_result.get("offers", [])
            if offers:
                lower = message.lower()
                number_words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5}
                count_match = re.search(r"\b(?:top|cheapest|lowest)\s+(\d+)\b", lower)
                requested_count = int(count_match.group(1)) if count_match else None
                if requested_count is None and re.search(r"cheapest|lowest|top", lower):
                    for word, number in number_words.items():
                        if re.search(rf"\b{word}\b", lower):
                            requested_count = number
                            break

                if requested_count is not None and re.search(r"cheapest|lowest|top", lower):
                    offers = sorted(offers, key=_offer_price)[:max(1, min(10, requested_count))]
                    previous_result = {**previous_result, "offers": offers}
                    reply = f"Here are the {len(offers)} lowest-priced options from your previous search."
                    action = "show_flights"
                elif re.search(r"\b(select|choose|what about)\b", lower):
                    index = _ordinal_index(lower)
                    if index is not None:
                        selected_index = index if index >= 0 else len(offers) - 1
                        if 0 <= selected_index < len(offers):
                            chosen = offers[selected_index]
                            previous_result = {
                                **previous_result,
                                "offers": offers,
                                "selected_offer_id": chosen.get("id"),
                            }
                            reply = (
                                f"{chosen.get('airline', 'This airline')} flight "
                                f"{chosen.get('flightNumber', '')} is the option you selected. "
                                "Review its details before continuing."
                            )
                            action = "select_flight"
                        else:
                            reply = f"I found {len(offers)} options. Please choose a number between 1 and {len(offers)}."
                            action = "show_flights"
                    else:
                        reply = f"Here are {len(offers)} flight options from your previous search."
                        action = "show_flights"
                else:
                    previous_result = {**previous_result, "offers": offers}
                    reply = f"Here are {len(offers)} flight options from your previous search."
                    action = "show_flights"

                return {
                    "conversation_id": cid,
                    "intent": "show_flights",
                    "entities": {},
                    "reply": reply,
                    "next_action": action,
                    "tool_result": previous_result,
                    "demo": True,
                }

        raw_history = await redis_client.get(f"conversation:{cid}")
        history = json.loads(raw_history) if raw_history else []
        raw_context = await redis_client.get(f"chat_context:{cid}")
        context = json.loads(raw_context) if raw_context else {}
        
        # A newly stated route starts a fresh search.
        # Remove stale booking details from the previous route.
        new_entities = extract_entities(message)
        has_new_route = bool(
            new_entities.get("departure_city")
            and new_entities.get("arrival_city")
        )

        if has_new_route:
            for key in (
                "booking_flow",
                "selected_offer",
                "date",
                "passengers",
                "cabin_class",
                "trip_type",
                "passenger_details",
            ):
                context.pop(key, None)

            await redis_client.set(
                f"chat_context:{cid}",
                json.dumps(context),
                ex=60 * 60 * 24 * 30,
            )
            await redis_client.delete(f"flight_search:{cid}")

        # Keep the chat booking flow aligned with the trip type selected in the workspace.
        if request.trip_type in {"one_way", "round_trip"}:
            context["trip_type"] = request.trip_type
        if request.passengers is not None:
            context["passengers"] = request.passengers


        # If the user names a specific returned flight and wants to proceed, attach that
        # exact cached provider offer to the conversation before invoking the graph.
        lower_message = normalize_message(message).casefold()
        booking_intent = bool(re.search(
            r"\b(?:proceed|book|select|choose|pick|take)\b|\bgo\s+(?:ahead\s+)?with\b|\blet(?:'|’)s\s+go\s+with\b",
            lower_message,
        )) or bool(
            re.search(r"\b(?:okay|ok|fine|good|works for me|sounds good)\b", lower_message)
            and re.search(r"\b\d{2,4}\b", lower_message)
        )
        if booking_intent and not context.get("booking_flow"):
            cached_for_booking = await redis_client.get(f"flight_search:{cid}")
            if cached_for_booking:
                try:
                    cached_data = json.loads(cached_for_booking)
                    offers_for_booking = cached_data.get("offers", []) or []
                    chosen_offer = None
                    referenced_number = re.search(r"\b\d{2,4}\b", lower_message)
                    referenced_airline_offers = []
                    for offer in offers_for_booking:
                        flight_no = str(offer.get("flightNumber") or offer.get("flightNo") or "")
                        airline = str(offer.get("airline") or "")
                        compact_flight_no = re.sub(r"[^a-z0-9]", "", flight_no.casefold())
                        flight_digits = re.search(r"\d{2,4}$", compact_flight_no)
                        mentions_flight = bool(
                            compact_flight_no
                            and compact_flight_no in re.sub(r"[^a-z0-9]", "", lower_message)
                        ) or bool(
                            flight_digits
                            and re.search(rf"\b{re.escape(flight_digits.group(0))}\b", lower_message)
                        )
                        if mentions_flight and (airline.casefold() in lower_message or not re.search(r"air\s+india|british|duffel", lower_message)):
                            chosen_offer = offer
                            break
                        if airline and airline.casefold() in lower_message:
                            referenced_airline_offers.append(offer)
                    if chosen_offer is None and referenced_number is None and len(referenced_airline_offers) == 1:
                        chosen_offer = referenced_airline_offers[0]
                    if chosen_offer is None and referenced_number is None and not referenced_airline_offers and len(offers_for_booking) == 1:
                        chosen_offer = offers_for_booking[0]
                    # Support ordinal choices such as "go with the second flight".
                    ordinal = _ordinal_index(lower_message)
                    if chosen_offer is None and ordinal is not None and re.search(r"\b(first|second|third|fourth|fifth|last|flight|option)\b", lower_message):
                        selected_index = ordinal if ordinal >= 0 else len(offers_for_booking) - 1
                        if 0 <= selected_index < len(offers_for_booking):
                            chosen_offer = offers_for_booking[selected_index]
                    if chosen_offer:
                        context["selected_offer"] = chosen_offer
                        await redis_client.set(f"chat_context:{cid}", json.dumps(context), ex=60 * 60 * 24 * 30)
                    elif offers_for_booking:
                        return {
                            "conversation_id": cid,
                            "intent": "continue_booking",
                            "entities": frontend_entity_contract(context),
                            "reply": "I couldn't identify the flight from that message. Say, for example, ‘okay, go with Air India 0538’ or ‘choose the second flight.’",
                            "next_action": "select_flight",
                            "tool_result": cached_data,
                            "demo": True,
                        }
                except (ValueError, TypeError):
                    logger.warning("Could not resolve selected cached flight for conversation %s", cid)

        result = await agent_graph.ainvoke({
            "conversation_id": cid,
            "message": message,
            "history": history,
            "context": context,
        })

        # Keep the conversation history.
        await redis_client.set(
            f"conversation:{cid}",
            json.dumps(result.get("history", [])[-12:]),
            ex=60 * 60 * 24 * 30,
        )

        tool_result = result.get("tool_result")
        entities_for_context = result.get("entities", {}) or {}
        if entities_for_context:
            context.update({
                key: value for key, value in entities_for_context.items()
                if value is not None and value != ""
            })
            await redis_client.set(
                f"chat_context:{cid}",
                json.dumps(context),
                ex=60 * 60 * 24 * 30,
            )

        # Cache structured flight results for follow-up messages.
        if (
            isinstance(tool_result, dict)
            and isinstance(tool_result.get("offers"), list)
            and tool_result.get("offers")
        ):
            await redis_client.set(
                f"flight_search:{cid}",
                json.dumps(tool_result),
                ex=60 * 60 * 24,
            )

        entities = frontend_entity_contract(result.get("entities", {}))

        return {
            "conversation_id": cid,
            "intent": result.get("intent", "faq"),
            "entities": entities,
            "reply": result.get("reply", "How can I help?"),
            "next_action": result.get("next_action", "faq"),
            "tool_result": tool_result,
            "demo": True,
        }

    except Exception as exc:
        logger.exception("Chat workflow failed for conversation %s", cid)
        raise HTTPException(
            status_code=502,
            detail=f"Agent workflow failed: {type(exc).__name__}",
        )


@app.get("/memory/{conversation_id}")
async def memory(conversation_id: str):
    raw = await redis_client.get(f"conversation:{conversation_id}")

    return {
        "conversation_id": conversation_id,
        "messages": json.loads(raw) if raw else [],
    }


@app.post("/memory/{conversation_id}/clear")
async def clear_memory(conversation_id: str):
    await redis_client.delete(
        f"conversation:{conversation_id}",
        f"flight_search:{conversation_id}",
        f"chat_context:{conversation_id}",
    )

    return {
        "conversation_id": conversation_id,
        "cleared": True,
    }


@app.get("/rag/policy")
async def policy_search(q: str):
    from .tools import search_policy

    try:
        return await search_policy(q)
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="Policy retrieval is temporarily unavailable",
        )
