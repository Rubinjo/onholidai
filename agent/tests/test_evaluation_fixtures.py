import hashlib
import json
import re
from pathlib import Path
from typing import Any

import pytest
from fixtures.doubles import (
    SYNTHETIC_OFFERS,
    DeterministicProviderDouble,
    TimeoutAfterCommitError,
)

AGENT_CORPUS_PATH = Path(__file__).parent / "fixtures" / "evaluation-corpus.json"
WEB_CORPUS_PATH = (
    Path(__file__).parents[2] / "web" / "tests" / "fixtures" / "evaluation-corpus.json"
)
PAYLOAD_KEYS = (
    "estimates",
    "unambiguousRequests",
    "ambiguities",
    "itineraryDays",
    "hardConflicts",
)


def load_corpus() -> dict[str, Any]:
    return json.loads(AGENT_CORPUS_PATH.read_text(encoding="utf-8"))


def test_corpus_copies_hash_and_exact_counts_are_deterministic() -> None:
    agent_bytes = AGENT_CORPUS_PATH.read_bytes()
    assert agent_bytes == WEB_CORPUS_PATH.read_bytes()

    corpus = load_corpus()
    payload = {key: corpus[key] for key in PAYLOAD_KEYS}
    digest = hashlib.sha256(
        json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
    ).hexdigest()

    assert corpus["metadata"]["corpusHash"] == f"sha256:{digest}"
    assert len(corpus["estimates"]) == 100
    assert len(corpus["unambiguousRequests"]) == 100
    assert len(corpus["ambiguities"]) == 20
    assert len(corpus["itineraryDays"]) == 100
    item_count = sum(
        len(day["input"]["itineraryDays"][0]["items"]) for day in corpus["itineraryDays"]
    )
    assert item_count == 500
    assert len(corpus["hardConflicts"]) == 20
    assert corpus["metadata"]["changeControl"]["reviewedReasonRequired"] is True
    assert corpus["metadata"]["changeControl"]["reviewedReason"]


def test_corpus_category_coverage_and_privacy() -> None:
    corpus = load_corpus()
    for category in (
        "origin",
        "date_flexibility",
        "party_eligibility",
        "style",
        "required_constraints",
    ):
        assert sum(category in case["categories"] for case in corpus["estimates"]) == 40
    for group in (
        "destinations",
        "dates_duration",
        "travellers",
        "preferences",
        "constraints",
    ):
        assert sum(case["group"] == group for case in corpus["unambiguousRequests"]) == 20

    serialized = AGENT_CORPUS_PATH.read_text(encoding="utf-8")
    assert not re.search(r"\b(?:email|phone|passport|payment|cardNumber|cvv)\b", serialized, re.I)
    assert not re.search(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", serialized, re.I)
    assert not re.search(r"(?:\d[ -]*?){13,19}", serialized)


def test_provider_double_covers_changed_unavailable_and_commit_edge_cases() -> None:
    assert [offer.status for offer in SYNTHETIC_OFFERS] == [
        "available",
        "changed",
        "unavailable",
    ]

    provider = DeterministicProviderDouble()
    with pytest.raises(TimeoutAfterCommitError):
        provider.commit(
            "request-timeout-001", "offer-available-001", "timeout_after_commit"
        )
    assert provider.commit("request-timeout-001", "offer-available-001")[0].duplicate

    duplicate = DeterministicProviderDouble().commit(
        "request-duplicate-001", "offer-changed-001", "duplicate"
    )
    contradictory = DeterministicProviderDouble().commit(
        "request-contradictory-001", "offer-available-001", "contradictory"
    )
    assert [outcome.duplicate for outcome in duplicate] == [False, True]
    assert [outcome.status for outcome in contradictory] == ["confirmed", "rejected"]
