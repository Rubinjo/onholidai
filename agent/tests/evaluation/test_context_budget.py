from onholidai_agent.context.compact import compact_context
from onholidai_agent.models.api import ContextMessage, ConversationSummary


def test_more_than_100_turns_preserve_rejected_choices_and_bound_recent_history():
    summary = ConversationSummary.model_validate(
        {
            "sourceTripVersion": 2,
            "rejectedOptions": ["Kyoto: previously rejected for cost"],
            "decisions": ["Keep vegetarian meals"],
            "openQuestions": ["Which city?"],
        }
    )
    messages = [
        ContextMessage.model_validate(
            {
                "id": f"10000000-0000-4000-8000-{index:012}",
                "role": "user",
                "redactedContent": "Synthetic planning " * 40,
                "occurredAt": "2030-01-01T00:00:00Z",
            }
        )
        for index in range(120)
    ]
    retained, recent, compacted = compact_context(summary, messages, 24000)
    assert compacted
    assert retained == summary
    assert retained.rejected_options == ["Kyoto: previously rejected for cost"]
    assert len(recent) <= 20
    assert sum(len(message.redacted_content.encode()) for message in recent) <= 8000
