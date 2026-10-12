import base64
import hashlib
import hmac
import json
from collections.abc import Sequence
from pathlib import Path
from typing import TypedDict, cast

import pytest

from onholidai_agent.api.security import (
    ServiceAudience,
    ServiceTokenClaims,
    ServiceTokenContext,
    ServiceTokenError,
    create_service_token,
    verify_service_token,
)


class FixtureContext(TypedDict):
    userId: str
    tripId: str
    requestId: str
    baseTripVersion: int


class TokenFixture(TypedDict):
    secret: str
    issuedAt: int
    ttlSeconds: int
    audience: str
    context: FixtureContext
    scopes: list[str]
    expectedToken: str


_FIXTURE_PATH = (
    Path(__file__).resolve().parents[2] / "contracts" / "agent-api" / "service-token.fixture.json"
)
FIXTURE = cast(TokenFixture, json.loads(_FIXTURE_PATH.read_text(encoding="utf-8")))
CONTEXT = ServiceTokenContext(
    user_id=FIXTURE["context"]["userId"],
    trip_id=FIXTURE["context"]["tripId"],
    request_id=FIXTURE["context"]["requestId"],
    base_trip_version=FIXTURE["context"]["baseTripVersion"],
)


def fixture_token() -> str:
    return create_service_token(
        secret=FIXTURE["secret"],
        audience="agent",
        context=CONTEXT,
        scopes=FIXTURE["scopes"],
        ttl_seconds=FIXTURE["ttlSeconds"],
        issued_at=FIXTURE["issuedAt"],
    )


def verify(
    token: str,
    *,
    expected_audience: ServiceAudience = "agent",
    expected_context: ServiceTokenContext = CONTEXT,
    required_scopes: Sequence[str] = ("trip:read",),
    now: int | None = None,
) -> ServiceTokenClaims:
    return verify_service_token(
        token,
        secret=FIXTURE["secret"],
        expected_audience=expected_audience,
        expected_context=expected_context,
        required_scopes=required_scopes,
        now=FIXTURE["issuedAt"] + 1 if now is None else now,
    )


def sign_unsafe(payload: dict[str, object]) -> str:
    header = encode_segment(
        json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode()
    )
    encoded_payload = encode_segment(json.dumps(payload, separators=(",", ":")).encode())
    signing_input = f"{header}.{encoded_payload}"
    signature = encode_segment(
        hmac.new(FIXTURE["secret"].encode(), signing_input.encode("ascii"), hashlib.sha256).digest()
    )
    return f"{signing_input}.{signature}"


def encode_segment(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def test_round_trips_deterministic_cross_language_fixture() -> None:
    token = fixture_token()
    claims = verify(token)
    assert token == FIXTURE["expectedToken"]
    assert claims.scopes == ("trip:read", "context:read", "proposal:create")


def test_rejects_tampering_expiry_and_wrong_audience() -> None:
    token = fixture_token()
    replacement = "B" if token.endswith("A") else "A"
    with pytest.raises(ServiceTokenError, match="signature"):
        verify(f"{token[:-1]}{replacement}")
    with pytest.raises(ServiceTokenError, match="expired"):
        verify(token, now=FIXTURE["issuedAt"] + FIXTURE["ttlSeconds"])
    with pytest.raises(ServiceTokenError, match="audience"):
        verify(token, expected_audience="web", required_scopes=["run:write"])


def test_rejects_unknown_missing_and_insufficient_scopes() -> None:
    claims: dict[str, object] = {
        "aud": "agent",
        "exp": FIXTURE["issuedAt"] + FIXTURE["ttlSeconds"],
        "iat": FIXTURE["issuedAt"],
        **FIXTURE["context"],
    }
    with pytest.raises(ServiceTokenError, match="unknown scope"):
        verify(sign_unsafe({**claims, "scopes": ["admin"]}))
    with pytest.raises(ServiceTokenError, match="claims"):
        verify(sign_unsafe(claims))
    with pytest.raises(ServiceTokenError, match="unknown scope"):
        verify(fixture_token(), required_scopes=["run:write"])


def test_binds_context_and_enforces_ttl_bound() -> None:
    wrong_context = ServiceTokenContext(
        user_id=CONTEXT.user_id,
        trip_id=CONTEXT.trip_id,
        request_id=CONTEXT.request_id,
        base_trip_version=CONTEXT.base_trip_version + 1,
    )
    with pytest.raises(ServiceTokenError, match="baseTripVersion context"):
        verify(fixture_token(), expected_context=wrong_context)
    with pytest.raises(ServiceTokenError, match="between 1 and 300"):
        create_service_token(
            secret=FIXTURE["secret"],
            audience="agent",
            context=CONTEXT,
            scopes=FIXTURE["scopes"],
            ttl_seconds=301,
        )


@pytest.mark.parametrize("scope", ["trip:read", "context:read", "proposal:create"])
def test_web_tokens_can_grant_scoped_internal_reads_and_proposals(scope: str) -> None:
    token = create_service_token(
        secret=FIXTURE["secret"],
        audience="web",
        context=CONTEXT,
        scopes=[scope],
        issued_at=FIXTURE["issuedAt"],
    )
    claims = verify(token, expected_audience="web", required_scopes=[scope])
    assert claims.scopes == (scope,)
    assert claims.user_id == CONTEXT.user_id


def test_agent_tokens_cannot_grant_internal_pricing_access() -> None:
    with pytest.raises(ServiceTokenError, match="unknown scope"):
        create_service_token(
            secret=FIXTURE["secret"],
            audience="agent",
            context=CONTEXT,
            scopes=["pricing:read"],
        )
