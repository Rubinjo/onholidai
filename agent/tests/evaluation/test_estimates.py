import asyncio
import json
from copy import deepcopy
from pathlib import Path
from time import perf_counter
from typing import cast

from onholidai_agent.graph.estimate import estimate
from onholidai_agent.models.api import CreateAgentRunRequest
from tests.fixtures.planning import complete_component_facts


def test_frozen_100_estimates_execute_real_graph_with_failure_inclusive_denominator():
    corpus = json.loads((Path(__file__).parents[1] / "fixtures/evaluation-corpus.json").read_text())
    cases = cast(list[dict[str, object]], corpus["estimates"])
    outcomes: list[bool] = []
    durations: list[float] = []
    required_accounted: list[bool] = []

    class Sources:
        def __init__(self, trip: dict[str, object]):
            self.trip = trip

        async def get_trip(self, request: CreateAgentRunRequest) -> dict[str, object]:
            return deepcopy(self.trip)

        async def search(
            self, request: CreateAgentRunRequest, query: dict[str, object]
        ) -> dict[str, object]:
            return {
                "offers": [
                    {
                        "component": {
                            **complete_component_facts(kind),
                            "id": f"a0000000-a000-4000-8000-a0000000000{index}",
                            "bookingStatus": "unbooked",
                            "type": kind,
                            "price": {
                                "currency": "EUR",
                                "finalCustomerMinor": 100000,
                                "taxesMinor": 0,
                                "feesMinor": 0,
                            },
                        }
                    }
                    for index, kind in enumerate(("flight", "accommodation"), 1)
                ]
            }

    async def evaluate():
        for case in cases:
            trip = cast(dict[str, object], case["input"])
            request = CreateAgentRunRequest.model_validate(
                {
                    "contractVersion": "1",
                    "requestId": "a0000000-a000-4000-8000-a00000000001",
                    "conversationId": "a0000000-a000-4000-8000-a00000000002",
                    "purpose": "initial_estimate",
                    "actor": {
                        "userId": "a0000000-a000-4000-8000-a00000000003",
                        "tripId": "a0000000-a000-4000-8000-a00000000004",
                        "baseTripVersion": 1,
                        "scopes": ["trip:read", "proposal:create"],
                    },
                    "message": "Estimate reviewed trip",
                    "context": {
                        "tripSummary": {"version": 1},
                        "contextBudget": {"maximumTokens": 24000},
                    },
                }
            )
            started = perf_counter()
            try:
                result = (await estimate(request, Sources(trip))).root
                success = result.kind == "proposal" and perf_counter() - started <= 30
                outcomes.append(success)
                if result.kind == "proposal":
                    assert [operation.target for operation in result.proposal.operations] == [
                        "/destinations",
                        "/components",
                        "/itineraryDays",
                    ]
                    assert all(
                        operation.target != "/availabilityWindows"
                        for operation in result.proposal.operations
                    )
                    required_accounted.append(
                        any(
                            "No activities before 10:00" in warning
                            for warning in result.proposal.warnings
                        )
                    )
                else:
                    required_accounted.append(False)
            except Exception:
                outcomes.append(False)
                required_accounted.append(False)
            durations.append((perf_counter() - started) * 1000)

    asyncio.run(evaluate())
    assert len(outcomes) == 100
    assert sum(outcomes) >= 95
    assert sum(required_accounted) >= 90
    print(
        f"Graph-only corpus: {sum(outcomes)}/100 proposals within 30s; "
        f"{sum(required_accounted)}/100 requirement disclosures; "
        f"p95={sorted(durations)[94]:.2f}ms. No BFF/database/live-provider latency claim."
    )
