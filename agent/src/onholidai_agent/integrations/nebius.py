import asyncio
from typing import Protocol

import httpx

from .http import bounded_post


class CompletionTransport(Protocol):
    async def complete(
        self, *, model: str, messages: list[dict[str, str]], maximum_output_tokens: int
    ) -> str: ...


class NebiusClient:
    """Injected OpenAI-compatible transport; no global client or tool execution."""

    def __init__(self, transport: CompletionTransport, model: str):
        self.transport = transport
        self.model = model

    async def complete(self, messages: list[dict[str, str]]) -> str:
        if (
            len(messages) > 22
            or sum(len(message.get("content", "").encode()) for message in messages) > 32768
        ):
            raise ValueError("model_context_exceeded")
        async with asyncio.timeout(8):
            result = await self.transport.complete(
                model=self.model, messages=messages, maximum_output_tokens=1200
            )
        if not result.strip() or len(result) > 4000:
            raise ValueError("invalid_model_result")
        return result


class DeterministicModel:
    async def complete(self, **_kwargs: object) -> str:
        messages = _kwargs.get("messages")
        if isinstance(messages, list) and any(
            isinstance(message, dict)
            and "Answer the traveller's question" in str(message.get("content", ""))
            for message in messages
        ):
            return (
                "Two options to explore: keep your current route and ask about its daily "
                "plans, or request a slower pace with longer stays and fewer transfers. "
                "Tell me what matters most and I can prepare a validated draft update. "
                "This is a deterministic planning example, not verified travel advice. "
                "No trip changes, reservations or payments have been made."
            )
        return "Synthetic read-only estimate. Review dates, route and every unresolved requirement."


class NebiusHttpTransport:
    def __init__(self, client: httpx.AsyncClient, base_url: str, key: str):
        self.client, self.base_url, self.key = client, base_url, key

    async def complete(
        self, *, model: str, messages: list[dict[str, str]], maximum_output_tokens: int
    ) -> str:
        from typing import cast

        data = await bounded_post(
            self.client,
            self.base_url.rstrip("/") + "/chat/completions",
            {"Authorization": f"Bearer {self.key}"},
            {"model": model, "messages": messages, "max_tokens": maximum_output_tokens},
        )
        choices = cast(list[dict[str, object]], data.get("choices", []))
        if not choices:
            raise ValueError("empty_model_result")
        message = cast(dict[str, object], choices[0].get("message", {}))
        content = message.get("content")
        if not isinstance(content, str):
            raise ValueError("invalid_model_result")
        return content
