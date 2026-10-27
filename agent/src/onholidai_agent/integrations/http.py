import asyncio
import json
from typing import cast

import httpx


async def bounded_post(
    client: httpx.AsyncClient,
    url: str,
    headers: dict[str, str],
    body: dict[str, object],
    *,
    timeout_seconds: float = 8,
) -> dict[str, object]:
    async with (
        asyncio.timeout(timeout_seconds),
        client.stream("POST", url, headers=headers, json=body) as response,
    ):
        response.raise_for_status()
        raw = bytearray()
        async for chunk in response.aiter_bytes():
            raw.extend(chunk)
            if len(raw) > 131072:
                raise ValueError("research_response_too_large")
        encoded = raw.decode()
        if response.headers.get("content-type", "").startswith("text/event-stream"):
            payloads = [
                line[5:].strip() for line in encoded.splitlines() if line.startswith("data:")
            ]
            if len(payloads) != 1:
                raise ValueError("unexpected_mcp_stream")
            encoded = payloads[0]
        value: object = json.loads(encoded)
        if not isinstance(value, dict):
            raise ValueError("invalid_research_response")
        return cast(dict[str, object], value)
