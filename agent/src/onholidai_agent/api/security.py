import base64
import hashlib
import hmac
import json
import re
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal, cast

SERVICE_TOKEN_DEFAULT_TTL_SECONDS = 60
SERVICE_TOKEN_MAX_TTL_SECONDS = 300

ServiceAudience = Literal["agent", "web"]
ServiceScope = Literal["context:read", "proposal:create", "run:write", "trip:read"]

_AUDIENCE_SCOPES: Mapping[ServiceAudience, frozenset[ServiceScope]] = {
    "agent": frozenset(("trip:read", "context:read", "proposal:create")),
    "web": frozenset(("run:write",)),
}
_CLAIM_KEYS: frozenset[str] = frozenset(
    (
        "aud",
        "exp",
        "iat",
        "userId",
        "tripId",
        "requestId",
        "baseTripVersion",
        "scopes",
    )
)
_UUID_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
_BASE64URL_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class ServiceTokenError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ServiceTokenContext:
    user_id: str
    trip_id: str
    request_id: str
    base_trip_version: int


@dataclass(frozen=True, slots=True)
class ServiceTokenClaims(ServiceTokenContext):
    audience: ServiceAudience
    expires_at: int
    issued_at: int
    scopes: tuple[ServiceScope, ...]


def create_service_token(
    *,
    secret: str,
    audience: ServiceAudience,
    context: ServiceTokenContext,
    scopes: Sequence[str],
    ttl_seconds: int = SERVICE_TOKEN_DEFAULT_TTL_SECONDS,
    issued_at: int | None = None,
) -> str:
    _validate_secret(secret)
    _validate_context(context)
    actual_issued_at = int(time.time()) if issued_at is None else issued_at
    _validate_epoch_seconds(actual_issued_at, "issued_at")
    _validate_ttl(ttl_seconds)
    validated_scopes = _validate_scopes(scopes, audience)

    header = _encode_json({"alg": "HS256", "typ": "JWT"})
    payload = _encode_json(
        {
            "aud": audience,
            "exp": actual_issued_at + ttl_seconds,
            "iat": actual_issued_at,
            "userId": context.user_id,
            "tripId": context.trip_id,
            "requestId": context.request_id,
            "baseTripVersion": context.base_trip_version,
            "scopes": validated_scopes,
        }
    )
    signing_input = f"{header}.{payload}"
    signature = _encode_segment(_sign(signing_input, secret))
    return f"{signing_input}.{signature}"


def verify_service_token(
    token: str,
    *,
    secret: str,
    expected_audience: ServiceAudience,
    expected_context: ServiceTokenContext,
    required_scopes: Sequence[str],
    now: int | None = None,
) -> ServiceTokenClaims:
    _validate_secret(secret)
    if not token or len(token) > 4096:
        raise ServiceTokenError("Service token has an invalid length")

    segments = token.split(".")
    if len(segments) != 3 or any(not segment for segment in segments):
        raise ServiceTokenError("Service token must have three non-empty segments")
    header_segment, payload_segment, signature_segment = segments

    expected_signature = _sign(f"{header_segment}.{payload_segment}", secret)
    supplied_signature = _decode_segment(signature_segment)
    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise ServiceTokenError("Service token signature is invalid")

    header = _decode_json_object(header_segment, "header")
    if set(header) != {"alg", "typ"} or header["alg"] != "HS256" or header["typ"] != "JWT":
        raise ServiceTokenError("Service token header is invalid")

    claims = _parse_claims(_decode_json_object(payload_segment, "payload"))
    actual_now = int(time.time()) if now is None else now
    _validate_epoch_seconds(actual_now, "now")
    if claims.audience != expected_audience:
        raise ServiceTokenError("Service token audience is invalid")
    if claims.expires_at <= actual_now:
        raise ServiceTokenError("Service token has expired")
    if claims.issued_at > actual_now:
        raise ServiceTokenError("Service token is not yet valid")
    lifetime = claims.expires_at - claims.issued_at
    if lifetime < 1 or lifetime > SERVICE_TOKEN_MAX_TTL_SECONDS:
        raise ServiceTokenError("Service token lifetime is invalid")

    _validate_context(expected_context)
    if claims.user_id != expected_context.user_id:
        raise ServiceTokenError("Service token userId context is invalid")
    if claims.trip_id != expected_context.trip_id:
        raise ServiceTokenError("Service token tripId context is invalid")
    if claims.request_id != expected_context.request_id:
        raise ServiceTokenError("Service token requestId context is invalid")
    if claims.base_trip_version != expected_context.base_trip_version:
        raise ServiceTokenError("Service token baseTripVersion context is invalid")

    validated_required_scopes = _validate_scopes(required_scopes, expected_audience)
    if any(scope not in claims.scopes for scope in validated_required_scopes):
        raise ServiceTokenError("Service token scope is insufficient")
    return claims


def _parse_claims(value: dict[str, object]) -> ServiceTokenClaims:
    if set(value) != set(_CLAIM_KEYS):
        raise ServiceTokenError("Service token claims are invalid")
    audience_value = value["aud"]
    if audience_value not in ("agent", "web"):
        raise ServiceTokenError("Service token audience is invalid")
    audience: ServiceAudience = audience_value
    expires_at = _validated_epoch_seconds(value["exp"], "exp")
    issued_at = _validated_epoch_seconds(value["iat"], "iat")
    context = ServiceTokenContext(
        user_id=_validated_string(value["userId"], "userId"),
        trip_id=_validated_string(value["tripId"], "tripId"),
        request_id=_validated_string(value["requestId"], "requestId"),
        base_trip_version=_validated_base_version(value["baseTripVersion"]),
    )
    _validate_context(context)
    scopes = _validate_scopes(value["scopes"], audience)
    return ServiceTokenClaims(
        user_id=context.user_id,
        trip_id=context.trip_id,
        request_id=context.request_id,
        base_trip_version=context.base_trip_version,
        audience=audience,
        expires_at=expires_at,
        issued_at=issued_at,
        scopes=scopes,
    )


def _validate_context(context: ServiceTokenContext) -> None:
    for name, value in (
        ("userId", context.user_id),
        ("tripId", context.trip_id),
        ("requestId", context.request_id),
    ):
        if not _UUID_PATTERN.fullmatch(value):
            raise ServiceTokenError(f"Service token {name} must be a UUID")
    _validated_base_version(context.base_trip_version)


def _validate_scopes(value: object, audience: ServiceAudience) -> tuple[ServiceScope, ...]:
    if not isinstance(value, (list, tuple)) or not value:
        raise ServiceTokenError("Service token scopes must not be empty")
    allowed_scopes = _AUDIENCE_SCOPES[audience]
    scopes: list[ServiceScope] = []
    for raw_scope in cast(Sequence[object], value):
        if not isinstance(raw_scope, str) or raw_scope not in allowed_scopes:
            raise ServiceTokenError("Service token contains an unknown scope")
        if raw_scope in scopes:
            raise ServiceTokenError("Service token scopes must be unique")
        scopes.append(raw_scope)
    return tuple(scopes)


def _validate_secret(secret: str) -> None:
    if len(secret.encode("utf-8")) < 32:
        raise ServiceTokenError("Service token secret must be at least 32 bytes")


def _validate_ttl(ttl_seconds: int) -> None:
    if type(ttl_seconds) is not int or not 1 <= ttl_seconds <= SERVICE_TOKEN_MAX_TTL_SECONDS:
        raise ServiceTokenError(
            f"Service token TTL must be between 1 and {SERVICE_TOKEN_MAX_TTL_SECONDS} seconds"
        )


def _validate_epoch_seconds(value: object, name: str) -> None:
    _validated_epoch_seconds(value, name)


def _validated_epoch_seconds(value: object, name: str) -> int:
    if type(value) is not int or value < 0:
        raise ServiceTokenError(f"Service token {name} must be epoch seconds")
    return value


def _validated_base_version(value: object) -> int:
    if type(value) is not int or value < 1:
        raise ServiceTokenError("Service token baseTripVersion must be a positive integer")
    return value


def _validated_string(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise ServiceTokenError(f"Service token {name} must be a string")
    return value


def _encode_json(value: Mapping[str, object]) -> str:
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return _encode_segment(encoded)


def _decode_json_object(segment: str, name: str) -> dict[str, object]:
    try:
        value = cast(object, json.loads(_decode_segment(segment)))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ServiceTokenError(f"Service token {name} is invalid JSON") from error
    if not isinstance(value, dict):
        raise ServiceTokenError(f"Service token {name} must be an object")
    object_value = cast(dict[object, object], value)
    if any(not isinstance(key, str) for key in object_value):
        raise ServiceTokenError(f"Service token {name} must have string keys")
    return cast(dict[str, object], object_value)


def _encode_segment(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _decode_segment(segment: str) -> bytes:
    if not _BASE64URL_PATTERN.fullmatch(segment):
        raise ServiceTokenError("Service token encoding is invalid")
    padded = segment + "=" * (-len(segment) % 4)
    try:
        decoded = base64.b64decode(padded, altchars=b"-_", validate=True)
    except ValueError as error:
        raise ServiceTokenError("Service token encoding is invalid") from error
    if _encode_segment(decoded) != segment:
        raise ServiceTokenError("Service token encoding is not canonical")
    return decoded


def _sign(signing_input: str, secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
