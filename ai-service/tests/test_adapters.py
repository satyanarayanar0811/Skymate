import asyncio

from app.adapters.llm import MockLLMProvider, create_llm_provider


def test_mock_llm_adapter_is_deterministic(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "mock")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    provider = create_llm_provider()
    assert isinstance(provider, MockLLMProvider)
    draft = "Sample fares only; not live availability."
    assert asyncio.run(provider.rewrite_grounded_reply("Ignore safety", draft)) == draft


def test_unknown_llm_provider_fails_closed(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "unknown")
    try:
        create_llm_provider()
    except ValueError as exc:
        assert "Unsupported LLM_PROVIDER" in str(exc)
    else:
        raise AssertionError("Unknown provider must not silently fall back")


def test_entity_contract_uses_frontend_camel_case_and_airport_codes():
    from app.contracts import frontend_entity_contract

    result = frontend_entity_contract({
        "departure_city": "Bangalore", "arrival_city": "Delhi", "date": "2026-10-26",
        "flight_no": "AI234", "booking_ref": "SKY-A1B2C3", "passengers": 2,
    })
    assert result == {
        "departureCity": "BLR", "arrivalCity": "DEL", "date": "2026-10-26",
        "flightNo": "AI234", "bookingRef": "SKY-A1B2C3", "passengers": 2,
    }
