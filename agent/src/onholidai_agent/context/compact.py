from collections.abc import Sequence

from onholidai_agent.models.api import ContextMessage, ConversationSummary


def compact_context(
    summary: ConversationSummary, messages: Sequence[ContextMessage], maximum_tokens: int
) -> tuple[ConversationSummary, list[ContextMessage], bool]:
    """Conservative UTF-8 token bound; preserve structured evidence, never infer trip facts."""
    size = sum(len(message.redacted_content.encode()) for message in messages)
    compact = len(messages) >= 100 or size >= maximum_tokens * 70 // 100
    recent: list[ContextMessage] = []
    used = 0
    for message in reversed(messages[-20:]):
        cost = len(message.redacted_content.encode())
        if used + cost > min(8000, maximum_tokens // 3):
            break
        recent.insert(0, message)
        used += cost
    return summary.model_copy(deep=True), recent, compact
