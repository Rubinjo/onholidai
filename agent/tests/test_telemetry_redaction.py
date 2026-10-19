from copy import deepcopy

from onholidai_agent.telemetry.redaction import REDACTED, redact_for_langsmith


def test_redacts_nested_production_langsmith_payload_without_mutating_source() -> None:
    payload = {
        "inputs": {
            "prompt": "Plan a trip for Alice",
            "constraints": {"dietary": "severe peanut allergy"},
        },
        "outputs": {"response": "A private itinerary"},
        "prompt_text": "Alternate raw prompt field",
        "metadata": {
            "provider": "synthetic",
            "outcome": "accepted",
            "authorization": "Bearer production-token",
            "traveller": {"email": "alice@example.test", "passport": "123456789"},
            "supplierPricing": {"amount": 950, "margin": 0.2, "currency": "EUR"},
        },
    }
    original = deepcopy(payload)

    redacted = redact_for_langsmith(payload, production=True)

    assert redacted == {
        "inputs": REDACTED,
        "outputs": REDACTED,
        "prompt_text": REDACTED,
        "metadata": {
            "provider": "synthetic",
            "outcome": "accepted",
            "authorization": REDACTED,
            "traveller": REDACTED,
            "supplierPricing": {"amount": REDACTED, "margin": REDACTED, "currency": "EUR"},
        },
    }
    assert payload == original


def test_non_production_keeps_synthetic_io_but_always_redacts_sensitive_fields() -> None:
    payload = {
        "inputs": {"prompt": "Synthetic evaluation prompt"},
        "outputs": {"response": "Synthetic evaluation response"},
        "api_key": "evaluation-secret",
        "passengers": [{"name": "Synthetic Person"}],
        "netRate": 500,
    }

    redacted = redact_for_langsmith(payload, production=False)

    assert redacted["inputs"] == payload["inputs"]
    assert redacted["outputs"] == payload["outputs"]
    assert redacted["api_key"] == REDACTED
    assert redacted["passengers"] == REDACTED
    assert redacted["netRate"] == REDACTED


def test_redacts_sensitive_keys_at_every_mapping_depth_and_in_cycles() -> None:
    cyclic: dict[str, object] = {"safe": "value", "accessToken": "secret"}
    cyclic["self"] = cyclic

    assert redact_for_langsmith(cyclic) == {
        "safe": "value",
        "accessToken": REDACTED,
        "self": REDACTED,
    }


def test_redacts_encoded_supplier_urls_and_separator_obfuscated_economics() -> None:
    payload = {
        "metadata": {
            "provider": "synthetic",
            "result": [
                "supplier_cost=991199",
                "https://provider.example/offer?platform%4dargin=883388",
                "https://provider.example/offer?api%4bey=private-canary",
            ],
        }
    }

    assert redact_for_langsmith(payload) == {
        "metadata": {"provider": "synthetic", "result": [REDACTED] * 3}
    }