import math
import re
from collections.abc import Mapping, Sequence, Set
from typing import cast, overload

REDACTED = "[REDACTED]"

type RedactedValue = (
    bool | int | float | str | list["RedactedValue"] | dict[str, "RedactedValue"] | None
)

_PRODUCTION_IO_KEYS = {
    "completion",
    "completions",
    "content",
    "input",
    "inputs",
    "inputtext",
    "llminput",
    "llmoutput",
    "message",
    "messages",
    "output",
    "outputs",
    "outputtext",
    "prompt",
    "prompts",
    "prompttext",
    "rawprompt",
    "rawresponse",
    "requestbody",
    "response",
    "responsebody",
    "responses",
    "responsetext",
    "text",
}
_SENSITIVE_KEY_PARTS = (
    "accesstoken",
    "address",
    "allergy",
    "amount",
    "apikey",
    "authorization",
    "birthdate",
    "cardnumber",
    "commission",
    "contact",
    "cookie",
    "costprice",
    "credential",
    "cvc",
    "cvv",
    "dateofbirth",
    "dietary",
    "email",
    "firstname",
    "fullname",
    "gender",
    "guest",
    "lastname",
    "loyaltynumber",
    "margin",
    "medical",
    "mobility",
    "nationality",
    "netamount",
    "netrate",
    "passenger",
    "passport",
    "password",
    "payment",
    "phone",
    "privatekey",
    "secret",
    "specialrequest",
    "supplieramount",
    "suppliercost",
    "token",
    "traveler",
    "traveller",
    "wholesale",
)
_SENSITIVE_VALUE_PATTERNS = (
    re.compile(r"\b(?:authorization|bearer|basic|api[_ -]?key|password|secret|token)\b", re.I),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
    re.compile(r"\b(?:supplier (?:amount|cost)|net rate|margin|passport|allerg(?:y|ies))\b", re.I),
    re.compile(r"(?:\d[ -]?){13,19}"),
)


def _normalized_key(key: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(key).lower())


def _is_sensitive_key(key: object) -> bool:
    normalized = _normalized_key(key)
    return any(part in normalized for part in _SENSITIVE_KEY_PARTS)


def _is_sensitive_string(value: str) -> bool:
    return any(pattern.search(value) for pattern in _SENSITIVE_VALUE_PATTERNS)


@overload
def redact_for_langsmith(value: str, *, production: bool = True) -> str: ...


@overload
def redact_for_langsmith(
    value: Mapping[str, object], *, production: bool = True
) -> dict[str, RedactedValue]: ...


@overload
def redact_for_langsmith(
    value: Sequence[object] | Set[object], *, production: bool = True
) -> list[RedactedValue] | str: ...


@overload
def redact_for_langsmith(value: object, *, production: bool = True) -> RedactedValue: ...


def redact_for_langsmith(value: object, *, production: bool = True) -> RedactedValue:
    """Return a JSON-compatible copy safe to send to LangSmith."""

    return _redact(value, production=production, active_ids=set())


def _redact(value: object, *, production: bool, active_ids: set[int]) -> RedactedValue:
    if value is None or isinstance(value, bool | int):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else REDACTED
    if isinstance(value, str):
        return REDACTED if _is_sensitive_string(value) else value
    if isinstance(value, bytes | bytearray | memoryview):
        return REDACTED

    value_id = id(value)
    if value_id in active_ids:
        return REDACTED

    active_ids.add(value_id)
    try:
        if isinstance(value, Mapping):
            redacted: dict[str, RedactedValue] = {}
            for key, item in cast(Mapping[object, object], value).items():
                key_text = str(key)
                normalized = _normalized_key(key)
                if _is_sensitive_key(key) or (production and normalized in _PRODUCTION_IO_KEYS):
                    redacted[key_text] = REDACTED
                else:
                    redacted[key_text] = _redact(
                        item,
                        production=production,
                        active_ids=active_ids,
                    )
            return redacted
        if isinstance(value, Set):
            return [
                _redact(item, production=production, active_ids=active_ids)
                for item in sorted(cast(Set[object], value), key=repr)
            ]
        if isinstance(value, Sequence):
            return [
                _redact(item, production=production, active_ids=active_ids)
                for item in cast(Sequence[object], value)
            ]
        return REDACTED
    finally:
        active_ids.remove(value_id)
