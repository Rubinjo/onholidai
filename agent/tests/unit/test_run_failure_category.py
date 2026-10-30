import asyncio

import httpx
import pytest

from onholidai_agent.api.runs import failure_code, problem_code
from onholidai_agent.api.store import PersistenceRejected, WebRunStore, response_problem_code
from tests.contract.test_refinement_tools import refinement_request

SECRET = "local-clock-diagnostic-secret-00000000"


def rejection(status: int, body: object) -> httpx.HTTPStatusError:
    request = httpx.Request("PUT", "http://web/api/v1/internal/agent-runs/run/events/1")
    return httpx.HTTPStatusError(
        "rejected",
        request=request,
        response=httpx.Response(status, json=body, request=request),
    )


@pytest.mark.parametrize(
    ("code", "expected"),
    [
        ("estimate_evidence_start_date", "invalid_result"),
        ("offer_unavailable", "invalid_result"),
        ("incomplete_estimate", "source_unavailable"),
        ("run_conflict", "estimate_unavailable"),
        ("guest_research_limited", "estimate_unavailable"),
    ],
)
def test_only_a_rejected_proposal_reports_invalid_evidence(code: str, expected: str) -> None:
    assert failure_code(PersistenceRejected(409, "persistence rejected (409)", code)) == expected


def test_a_reprice_without_complete_inventory_is_a_source_outage() -> None:
    # Web refuses the proposal when its own repricing finds no complete current
    # inventory; the traveller can retry, so this is not an unexpected failure.
    error = rejection(409, {"code": "incomplete_estimate"})
    assert problem_code(error) == "incomplete_estimate"
    assert failure_code(error) == "source_unavailable"


def test_deadline_empty_sources_and_unexpected_errors_stay_distinct() -> None:
    assert failure_code(TimeoutError()) == "estimate_deadline"
    assert failure_code(ValueError("source_unavailable")) == "source_unavailable"
    assert failure_code(RuntimeError("boom")) == "estimate_unavailable"
    assert (
        failure_code(PersistenceRejected(409, "persistence rejected (409)", None))
        == "estimate_unavailable"
    )


def test_a_read_rejection_is_classified_from_its_http_status() -> None:
    error = rejection(504, {"code": "supplier_research_deadline"})
    assert problem_code(error) == "supplier_research_deadline"
    assert failure_code(error) == "estimate_unavailable"


@pytest.mark.parametrize("code", ["NOT a code", "x" * 200, 17, None])
def test_only_a_bounded_problem_code_is_accepted(code: object) -> None:
    assert response_problem_code(httpx.Response(409, json={"code": code})) is None


def test_an_unreadable_rejection_body_never_fabricates_a_category() -> None:
    assert response_problem_code(httpx.Response(409, content=b"not json")) is None


def test_a_refused_callback_carries_its_public_problem_code() -> None:
    async def check() -> None:
        request = refinement_request("What are my options?")
        transport = httpx.MockTransport(
            lambda _: httpx.Response(
                409, json={"status": 409, "code": "estimate_evidence_start_date"}
            )
        )
        async with httpx.AsyncClient(transport=transport, base_url="http://web") as client:
            with pytest.raises(PersistenceRejected) as refused:
                await WebRunStore(client, SECRET).persist(
                    request, "/api/v1/internal/agent-runs/run/result", {}
                )
        assert refused.value.status == 409
        assert refused.value.code == "estimate_evidence_start_date"
        assert failure_code(refused.value) == "invalid_result"

    asyncio.run(check())
