import asyncio
from unittest.mock import patch

import httpx

from onholidai_agent.api.security import ServiceTokenContext, verify_service_token
from onholidai_agent.api.store import WebRunStore
from tests.contract.test_refinement_tools import refinement_request


def test_callbacks_remain_valid_at_a_cross_runtime_second_boundary_without_relaxing_verifier():
    async def check():
        request = refinement_request("What are my options?")
        secret = "local-clock-diagnostic-secret-00000000"
        async with httpx.AsyncClient() as client:
            with patch("onholidai_agent.api.store.time.time", return_value=1800000000.001):
                headers = WebRunStore(client, secret).headers(request, "run:write")
        claims = verify_service_token(
            headers["authorization"].removeprefix("Bearer "),
            secret=secret,
            expected_audience="web",
            expected_context=ServiceTokenContext(
                request.actor.user_id,
                request.actor.trip_id,
                request.request_id,
                request.actor.base_trip_version,
            ),
            required_scopes=["run:write"],
            now=1799999999,
        )
        assert claims.issued_at == 1799999999
        assert claims.expires_at == 1800000059

    asyncio.run(check())
