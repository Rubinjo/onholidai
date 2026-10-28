from uuid import uuid4

from onholidai_agent.models.api import AgentResult


def question(text: str, reason: str = "scope") -> AgentResult:
    """One focused question for a material fact the agent cannot infer."""
    return AgentResult.model_validate(
        {
            "kind": "clarification",
            "message": "A choice is needed before proposing changes.",
            "clarification": {"id": str(uuid4()), "question": text, "materialReason": reason},
        }
    )
