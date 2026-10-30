from uuid import uuid4

from onholidai_agent.models.api import AgentResult

# A resumed run keeps the traveller's original request and appends the answer to its
# own clarification. The marker separates the two: intent is read from the request and
# the resolved choice from the answer, so answering never looks like a new request.
ANSWER_MARKER = "\nClarification: "


def compose_resumed_message(message: str, answer: str) -> str:
    return f"{message}{ANSWER_MARKER}{answer}"


def original_request(message: str) -> str:
    """The traveller's own words, without any clarification answer."""
    return message.split(ANSWER_MARKER, maxsplit=1)[0].strip()


def answered_choices(message: str) -> tuple[str, ...]:
    """Answers already given to this run's clarifications, oldest first."""
    return tuple(part.strip() for part in message.split(ANSWER_MARKER)[1:] if part.strip())


def question(text: str, reason: str = "scope") -> AgentResult:
    """One focused question for a material fact the agent cannot infer."""
    return AgentResult.model_validate(
        {
            "kind": "clarification",
            "message": "A choice is needed before proposing changes.",
            "clarification": {"id": str(uuid4()), "question": text, "materialReason": reason},
        }
    )
