import asyncio
import re
from typing import Protocol

import httpx

from .http import bounded_post

# Reasoning tokens count against the completion budget, so the answer only gets what is
# left. A tight budget makes the provider stop mid-answer, or spill its reasoning
# transcript into the answer field once the thinking text exhausts the budget.
DEFAULT_MAXIMUM_OUTPUT_TOKENS = 4096
MAXIMUM_OUTPUT_TOKENS_CEILING = 8192
MAXIMUM_ADVICE_CHARACTERS = 48000
MAXIMUM_COMPLETION_ATTEMPTS = 3
DEFAULT_REQUEST_TIMEOUT_SECONDS = 90.0
CONTINUATION_INSTRUCTION = (
    "Your previous reply stopped at the output limit. Continue exactly where it ended, "
    "without repeating anything already written, without a preamble, and finish the answer."
)

# Reasoning is never user-facing. Providers may return it in a sibling field or, once the
# budget is exhausted, inline in the answer field itself.
_THINKING_BLOCK = re.compile(
    r"<think(?:ing)?>.*?(?:</think(?:ing)?>|\Z)", re.IGNORECASE | re.DOTALL
)
_REASONING_PREAMBLE = re.compile(
    r"^\s*(?:#{1,6}\s*)?(?:"
    r"here(?:'|\u2019)?s (?:a|my|the) (?:thinking|thought|reasoning) process|"
    r"thinking process|reasoning process|chain[ -]of[ -]thought|"
    r"let me think|thinking:|reasoning:"
    r")",
    re.IGNORECASE,
)


class ModelOutputTruncated(ValueError):
    """The provider stopped at the token budget; ``partial`` holds the finished prefix."""

    def __init__(self, partial: str = ""):
        super().__init__("model_output_truncated")
        self.partial = partial


def final_answer_text(content: str) -> str:
    """Reduce a provider message to user-ready answer text, or empty when it is reasoning."""
    text = _THINKING_BLOCK.sub("", content)
    if _REASONING_PREAMBLE.match(text):
        return ""
    return text.strip()


class CompletionTransport(Protocol):
    async def complete(
        self, *, model: str, messages: list[dict[str, str]], maximum_output_tokens: int
    ) -> str: ...


class NebiusClient:
    """Injected OpenAI-compatible transport; no global client or tool execution."""

    def __init__(
        self,
        transport: CompletionTransport,
        model: str,
        maximum_output_tokens: int = DEFAULT_MAXIMUM_OUTPUT_TOKENS,
        request_timeout_seconds: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
    ):
        self.transport = transport
        self.model = model
        self.maximum_output_tokens = max(
            1, min(maximum_output_tokens, MAXIMUM_OUTPUT_TOKENS_CEILING)
        )
        self.request_timeout_seconds = request_timeout_seconds

    async def complete(self, messages: list[dict[str, str]]) -> str:
        if (
            len(messages) > 22
            or sum(len(message.get("content", "").encode()) for message in messages) > 32768
        ):
            raise ValueError("model_context_exceeded")
        # A truncated reply is never delivered as if it were the whole answer: finish the
        # text through a continuation, or widen the budget when only reasoning fit.
        budget = self.maximum_output_tokens
        conversation = messages
        parts: list[str] = []
        async with asyncio.timeout(self.request_timeout_seconds):
            for attempt in range(MAXIMUM_COMPLETION_ATTEMPTS):
                try:
                    parts.append(
                        await self.transport.complete(
                            model=self.model,
                            messages=conversation,
                            maximum_output_tokens=budget,
                        )
                    )
                    break
                except ModelOutputTruncated as truncated:
                    if truncated.partial:
                        parts.append(truncated.partial)
                        conversation = [
                            *messages,
                            {"role": "assistant", "content": "".join(parts)},
                            {"role": "user", "content": CONTINUATION_INSTRUCTION},
                        ]
                    elif budget < MAXIMUM_OUTPUT_TOKENS_CEILING:
                        budget = min(MAXIMUM_OUTPUT_TOKENS_CEILING, budget * 2)
                    if attempt == MAXIMUM_COMPLETION_ATTEMPTS - 1:
                        raise ValueError("model_output_truncated") from None
        result = "".join(parts).strip()
        if not result or len(result) > MAXIMUM_ADVICE_CHARACTERS:
            raise ValueError("invalid_model_result")
        return result


class DeterministicModel:
    async def complete(
        self, *, model: str, messages: list[dict[str, str]], maximum_output_tokens: int
    ) -> str:
        if any(
            "Answer the traveller's question" in message.get("content", "") for message in messages
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
    def __init__(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        key: str,
        request_timeout_seconds: float = DEFAULT_REQUEST_TIMEOUT_SECONDS,
    ):
        self.client, self.base_url, self.key = client, base_url, key
        self.request_timeout_seconds = request_timeout_seconds

    async def complete(
        self, *, model: str, messages: list[dict[str, str]], maximum_output_tokens: int
    ) -> str:
        from typing import cast

        data = await bounded_post(
            self.client,
            self.base_url.rstrip("/") + "/chat/completions",
            {"Authorization": f"Bearer {self.key}"},
            {"model": model, "messages": messages, "max_tokens": maximum_output_tokens},
            timeout_seconds=self.request_timeout_seconds,
        )
        choices = cast(list[dict[str, object]], data.get("choices", []))
        if not choices:
            raise ValueError("empty_model_result")
        choice = cast(dict[str, object], choices[0])
        message = cast(dict[str, object], choice.get("message", {}))
        content = message.get("content")
        if not isinstance(content, str):
            # Reasoning-only replies (``reasoning``/``reasoning_content``) are not answers.
            raise ValueError("invalid_model_result")
        answer = final_answer_text(content)
        if choice.get("finish_reason") == "length":
            raise ModelOutputTruncated(answer)
        if not answer:
            raise ValueError("invalid_model_result")
        return answer
