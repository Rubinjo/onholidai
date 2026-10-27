import asyncio
import json
from copy import deepcopy
from pathlib import Path
from typing import cast

import httpx
import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError
from pydantic import ValidationError

from onholidai_agent.api.security import ServiceTokenContext, verify_service_token
from onholidai_agent.api.store import WebRunStore
from onholidai_agent.graph.router import dispatch
from onholidai_agent.integrations.nebius import DeterministicModel, NebiusClient
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.integrations.supplier_mcp import supplier_server
from onholidai_agent.models.api import AgentRun, ChangeProposal, CreateAgentRunRequest
from tests.integration.test_estimate import request

ROOT = Path(__file__).resolve().parents[3]
REF = "10000000-0000-4000-8000-000000000010"
QUERY: dict[str, object] = {
    "componentTypes": ["flight", "rail"],
    "destinationIds": ["10000000-0000-4000-8000-000000000005"],
    "startDate": "2030-05-01",
    "endDate": "2030-05-08",
}
SECRET = "synthetic-local-service-secret-000000000"


def research_request(owner: str | None = None) -> CreateAgentRunRequest:
    body = request().model_dump(mode="json", by_alias=True)
    body["purpose"] = "supplier_research"
    body["message"] = json.dumps(QUERY)
    actor = cast(dict[str, object], body["actor"])
    actor["scopes"] = ["trip:read"]
    if owner:
        actor["userId"] = owner
    return CreateAgentRunRequest.model_validate(body)


def test_selected_runtime_reads_only_exact_granted_revisions_through_the_real_mcp_protocol():
    async def check():
        raw = request().model_dump(mode="json", by_alias=True)
        raw["purpose"] = "refinement"
        raw["selectedOffers"] = [{"offerRef": REF, "revision": 2}]
        selected_request = CreateAgentRunRequest.model_validate(raw)
        calls: list[httpx.Request] = []
        cases = json.loads((ROOT / "contracts/supply/validation-cases.json").read_text())
        expected = {
            **next(
                case["value"]
                for case in cases["offerCases"]
                if case["id"] == "public-nuitee-multi-room-discovery"
            ),
            "sourceMode": "deterministic",
            "queryFingerprint": None,
            "partyFingerprint": None,
            "offerRef": REF,
            "revision": 2,
        }

        def web(http: httpx.Request) -> httpx.Response:
            calls.append(http)
            assert http.method == "GET"
            assert http.url.path.endswith(f"/planning-offers/{REF}")
            assert http.url.params["revision"] == "2"
            assert http.headers["x-request-id"] == selected_request.request_id
            return httpx.Response(200, json={"outcome": "unknown", "offer": expected})

        async with httpx.AsyncClient(
            base_url="http://web", transport=httpx.MockTransport(web)
        ) as http:
            sources = EstimateSources(
                WebRunStore(http, SECRET),
                NebiusClient(DeterministicModel(), "synthetic-model"),
            )
            assert await sources.selected_offers(selected_request) == [expected]
        assert len(calls) == 1

    asyncio.run(check())


def test_real_protocol_has_exactly_four_closed_read_tools_and_signed_calls():
    async def check() -> None:
        calls: list[httpx.Request] = []
        trusted = research_request()

        def web(http: httpx.Request) -> httpx.Response:
            calls.append(http)
            verify_service_token(
                http.headers["authorization"][7:],
                secret=SECRET,
                expected_audience="web",
                expected_context=ServiceTokenContext(
                    trusted.actor.user_id,
                    trusted.actor.trip_id,
                    trusted.request_id,
                    trusted.actor.base_trip_version,
                ),
                required_scopes=["trip:read"],
            )
            assert http.headers["x-base-trip-version"] == "1"
            assert http.headers["x-request-id"] == trusted.request_id
            if http.url.path.endswith("planning-search"):
                assert json.loads(http.content) == QUERY
                return httpx.Response(
                    200,
                    json={
                        "offers": [],
                        "outcomes": [
                            {"componentType": "rail", "status": "unsupported"},
                        ],
                    },
                )
            if http.url.path.endswith("revalidations"):
                assert json.loads(http.content) == {"revision": 1}
                return httpx.Response(
                    200,
                    json={
                        "outcome": "unknown",
                        "offer": None,
                        "differences": [],
                    },
                )
            if http.url.path.endswith("planning-capabilities"):
                assert http.url.params["componentTypes"] == "flight,rail"
                return httpx.Response(200, json={"capabilities": []})
            assert http.url.params["revision"] == "1"
            return httpx.Response(200, json={"outcome": "expired", "offer": None})

        async with httpx.AsyncClient(
            base_url="http://web",
            transport=httpx.MockTransport(web),
        ) as http:
            server = supplier_server(WebRunStore(http, SECRET), trusted)
            # Mutating the caller's object cannot change captured authority.
            trusted.actor.user_id = "10000000-0000-4000-8000-000000000099"
            trusted = research_request()
            async with Client(server) as client:
                tools = await client.list_tools()
                assert {tool.name for tool in tools} == {
                    "supplier_search",
                    "supplier_offer_details",
                    "supplier_revalidate_offer",
                    "supplier_capabilities",
                }
                for tool in tools:
                    assert tool.input_schema["additionalProperties"] is False
                    assert tool.annotations is not None
                    assert tool.annotations.read_only_hint is True
                    assert tool.annotations.destructive_hint is False
                result = await client.call_tool("supplier_search", QUERY)
                assert result.structured_content == {
                    "offers": [],
                    "outcomes": [
                        {"componentType": "rail", "status": "unsupported"},
                    ],
                }
                for tool in ("supplier_offer_details", "supplier_revalidate_offer"):
                    await client.call_tool(tool, {"offerRef": REF, "revision": 1})
                await client.call_tool(
                    "supplier_capabilities",
                    {"componentTypes": ["flight", "rail"]},
                )
        assert [call.method for call in calls] == ["POST", "GET", "POST", "GET"]
        assert all("/internal/trips/" in call.url.path for call in calls)

    asyncio.run(check())


@pytest.mark.parametrize(
    "tool,args",
    [
        ("supplier_search", {**QUERY, "owner": REF}),
        ("supplier_search", {**QUERY, "token": "no"}),
        ("supplier_search", {**QUERY, "context": {"userId": REF}}),
        ("supplier_search", {**QUERY, "baseTripVersion": 2}),
        ("supplier_search", {**QUERY, "componentTypes": []}),
        ("supplier_search", {**QUERY, "componentTypes": ["rail", "rail"]}),
        ("supplier_search", {**QUERY, "destinationIds": ["invalid"]}),
        ("supplier_search", {**QUERY, "startDate": "2030-02-30"}),
        ("supplier_search", {**QUERY, "endDate": "2029-01-01"}),
        ("supplier_search", {**QUERY, "propertyTypes": ["hotel"] * 17}),
        ("supplier_offer_details", {"offerRef": REF, "revision": "1"}),
        ("supplier_offer_details", {"offerRef": REF, "revision": True}),
        ("supplier_offer_details", {"offerRef": REF, "revision": 0}),
        ("supplier_revalidate_offer", {"offerRef": REF, "revision": 1, "method": "book"}),
        ("supplier_capabilities", {"componentTypes": ["rail", "rail"]}),
        ("supplier_capabilities", {"tripId": REF}),
        ("book_trip", {}),
    ],
)
def test_invalid_protocol_calls_never_reach_web(tool: str, args: dict[str, object]):
    async def check() -> None:
        def forbidden(_: httpx.Request) -> httpx.Response:
            pytest.fail("invalid arguments reached web")

        async with (
            httpx.AsyncClient(
                base_url="http://web",
                transport=httpx.MockTransport(forbidden),
            ) as http,
            Client(
                supplier_server(
                    WebRunStore(http, SECRET),
                    research_request(),
                )
            ) as client,
        ):
            with pytest.raises(ToolError):
                await client.call_tool(tool, args)

    asyncio.run(check())


@pytest.mark.parametrize("status", [403, 404, 409])
def test_web_access_rechecked_on_every_protocol_read(status: int):
    async def check() -> None:
        count = 0

        def web(_: httpx.Request) -> httpx.Response:
            nonlocal count
            count += 1
            return httpx.Response(status, json={"detail": "private-canary"})

        async with httpx.AsyncClient(
            base_url="http://web",
            transport=httpx.MockTransport(web),
        ) as http:
            async with Client(
                supplier_server(
                    WebRunStore(http, SECRET),
                    research_request(),
                )
            ) as client:
                for name in ("supplier_offer_details", "supplier_revalidate_offer"):
                    with pytest.raises(ToolError) as error:
                        await client.call_tool(name, {"offerRef": REF, "revision": 1})
                    assert "private-canary" not in str(error.value)
                with pytest.raises(ToolError):
                    await client.call_tool("supplier_capabilities", {})
            assert count == 3

    asyncio.run(check())


def test_concurrent_servers_never_exchange_owner_context():
    async def check() -> None:
        async def run(owner: str) -> None:
            def web(http: httpx.Request) -> httpx.Response:
                assert http.headers["x-user-id"] == owner
                return httpx.Response(200, json={"capabilities": [{"owner": owner}]})

            async with (
                httpx.AsyncClient(
                    base_url="http://web",
                    transport=httpx.MockTransport(web),
                ) as http,
                Client(
                    supplier_server(
                        WebRunStore(http, SECRET),
                        research_request(owner),
                    )
                ) as client,
            ):
                await asyncio.sleep(0)
                result = await client.call_tool("supplier_capabilities", {})
                assert result.structured_content == {"capabilities": [{"owner": owner}]}

        await asyncio.gather(run(REF), run("10000000-0000-4000-8000-000000000011"))

    asyncio.run(check())


def test_research_dispatch_uses_protocol_and_only_returns_bounded_references():
    async def check() -> None:
        observed: list[str] = []

        def web(http: httpx.Request) -> httpx.Response:
            observed.append(http.url.path)
            return httpx.Response(
                200,
                json={
                    "offers": [],
                    "outcomes": [
                        {"componentType": "rail", "status": "unsupported"},
                    ],
                },
            )

        trusted = research_request()
        before = deepcopy(trusted)
        async with httpx.AsyncClient(
            base_url="http://web",
            transport=httpx.MockTransport(web),
        ) as http:
            result = await dispatch(trusted, WebRunStore(http, SECRET))
        assert result.root.kind == "answer"
        assert json.loads(result.root.message)["offers"] == []
        assert "unsupported" in result.root.message
        assert observed == [f"/api/v1/internal/trips/{trusted.actor.trip_id}/planning-search"]
        assert trusted == before

    asyncio.run(check())


def test_research_is_run_purpose_never_proposal_purpose():
    trusted = research_request()
    assert trusted.purpose == "supplier_research"
    schema = ChangeProposal.model_json_schema()
    assert "supplier_research" not in schema["$defs"]["ProposalPurpose"]["enum"]
    run_schema = AgentRun.model_json_schema()
    assert "supplier_research" in run_schema["$defs"]["RunPurpose"]["enum"]
    with pytest.raises(ValidationError):
        ChangeProposal.model_validate(
            {
                "id": REF,
                "purpose": "supplier_research",
                "initiatingRequestId": trusted.request_id,
                "baseTripVersion": 1,
                "operations": [
                    {"operation": "replace", "target": "/preferences/pace", "value": 60}
                ],
                "affectedFacts": ["pace"],
                "rationale": "Not allowed",
                "tradeoffs": [],
                "warnings": [],
                "expiresAt": "2030-01-01T00:10:00Z",
            }
        )
    without_proposal_scope = request().model_dump(mode="json", by_alias=True)
    actor = cast(dict[str, object], without_proposal_scope["actor"])
    actor["scopes"] = ["trip:read"]
    with pytest.raises(ValidationError):
        CreateAgentRunRequest.model_validate(without_proposal_scope)


@pytest.mark.parametrize(
    "tool,result",
    [
        ("supplier_search", {"offers": [{"invalid": True}] * 33}),
        ("supplier_offer_details", {"outcome": "confirmed", "offer": None}),
        ("supplier_revalidate_offer", {"outcome": "unchanged", "offer": None, "differences": []}),
        ("supplier_revalidate_offer", {"outcome": "unknown", "offer": None, "differences": [None]}),
        ("supplier_capabilities", {"capabilities": "arbitrary text"}),
    ],
)
def test_invalid_wire_results_fail_closed(tool: str, result: dict[str, object]):
    async def check() -> None:
        def web(_: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json=result)

        async with (
            httpx.AsyncClient(
                base_url="http://web",
                transport=httpx.MockTransport(web),
            ) as http,
            Client(
                supplier_server(
                    WebRunStore(http, SECRET),
                    research_request(),
                )
            ) as client,
        ):
            args = (
                QUERY
                if tool == "supplier_search"
                else ({} if tool == "supplier_capabilities" else {"offerRef": REF, "revision": 1})
            )
            with pytest.raises(ToolError):
                await client.call_tool(tool, args)

    asyncio.run(check())


@pytest.mark.parametrize("case_id", ["public-flight", "public-nuitee-multi-room-discovery"])
def test_public_offer_output_uses_canonical_schema(case_id: str):
    async def check() -> None:
        cases = json.loads((ROOT / "contracts/supply/validation-cases.json").read_text())
        valid = {
            **next(case["value"] for case in cases["offerCases"] if case["id"] == case_id),
            "sourceMode": "deterministic",
            "queryFingerprint": None,
            "partyFingerprint": None,
            "offerRef": REF,
            "revision": 1,
        }
        incomplete = deepcopy(valid)
        component = cast(dict[str, object], incomplete["component"])
        for field in ("serviceStart", "serviceEnd", "details", "cancellationTerms"):
            component[field] = None
        price = cast(dict[str, object], component["price"])
        for field in ("finalCustomerMinor", "taxesMinor", "feesMinor"):
            price[field] = None
        for offer, success in [
            (valid, True),
            (incomplete, True),
            ({"supplierAmount": 123}, False),
        ]:

            def web(_: httpx.Request, selected: object = offer) -> httpx.Response:
                return httpx.Response(200, json={"offers": [selected], "outcomes": []})

            async with (
                httpx.AsyncClient(
                    base_url="http://web",
                    transport=httpx.MockTransport(web),
                ) as http,
                Client(
                    supplier_server(
                        WebRunStore(http, SECRET),
                        research_request(),
                    )
                ) as client,
            ):
                result = await client.call_tool("supplier_search", QUERY, raise_on_error=False)
                assert result.is_error is not success

    asyncio.run(check())


@pytest.mark.parametrize("outcome", ["unsupported", "changed", "expired"])
def test_nuitee_multi_room_evidence_through_all_four_read_tools(outcome: str):
    async def check() -> None:
        cases = json.loads((ROOT / "contracts/supply/validation-cases.json").read_text())
        offer = {
            **next(
                case["value"]
                for case in cases["offerCases"]
                if case["id"] == "public-nuitee-multi-room-discovery"
            ),
            "offerRef": REF,
            "revision": 1,
            "sourceMode": "deterministic",
            "queryFingerprint": None,
            "partyFingerprint": None,
        }
        responses: dict[str, dict[str, object]] = {
            "planning-search": {
                "offers": [offer],
                "outcomes": [
                    {"provider": "duffel", "componentType": "flight", "status": "error"},
                    {"provider": "nuitee", "componentType": "accommodation", "status": "available"},
                    {"provider": "viator", "componentType": "activity", "status": "no_matches"},
                ],
            },
            REF: {"outcome": "available", "offer": offer},
            "revalidations": {"outcome": outcome, "offer": offer, "differences": []},
            "planning-capabilities": {
                "capabilities": [
                    {"provider": "nuitee", "componentType": "accommodation"},
                ]
            },
        }
        calls: list[str] = []

        def web(http: httpx.Request) -> httpx.Response:
            endpoint = http.url.path.rsplit("/", 1)[-1]
            calls.append(endpoint)
            return httpx.Response(200, json=responses[endpoint])

        trusted = research_request()
        before = deepcopy(trusted)
        async with (
            httpx.AsyncClient(base_url="http://web", transport=httpx.MockTransport(web)) as http,
            Client(supplier_server(WebRunStore(http, SECRET), trusted)) as client,
        ):
            for tool, args, endpoint in [
                ("supplier_search", QUERY, "planning-search"),
                ("supplier_offer_details", {"offerRef": REF, "revision": 1}, REF),
                ("supplier_revalidate_offer", {"offerRef": REF, "revision": 1}, "revalidations"),
                ("supplier_capabilities", {}, "planning-capabilities"),
            ]:
                result = await client.call_tool(tool, args)
                assert result.structured_content == responses[endpoint]
        assert calls == ["planning-search", REF, "revalidations", "planning-capabilities"]
        assert trusted == before

    asyncio.run(check())


@pytest.mark.parametrize(
    "outcome",
    [
        "available",
        "expired",
        "unchanged",
        "changed",
        "unknown",
        "unavailable",
        "unsupported",
    ],
)
def test_detail_enrichment_outcomes_pass_protocol_without_changing_context(outcome: str):
    async def check() -> None:
        cases = json.loads((ROOT / "contracts/supply/validation-cases.json").read_text())
        offer = {
            **next(case["value"] for case in cases["offerCases"] if case["valid"]),
            "sourceMode": "deterministic",
            "queryFingerprint": None,
            "partyFingerprint": None,
            "offerRef": REF,
            "revision": 2,
        }
        result = {"outcome": outcome, "offer": offer}

        def web(http: httpx.Request) -> httpx.Response:
            assert http.method == "GET"
            assert http.url.params["revision"] == "1"
            assert http.headers["x-user-id"] == research_request().actor.user_id
            return httpx.Response(200, json=result)

        async with (
            httpx.AsyncClient(
                base_url="http://web",
                transport=httpx.MockTransport(web),
            ) as http,
            Client(
                supplier_server(
                    WebRunStore(http, SECRET),
                    research_request(),
                )
            ) as client,
        ):
            response = await client.call_tool(
                "supplier_offer_details",
                {"offerRef": REF, "revision": 1},
            )
            assert response.structured_content == result

    asyncio.run(check())
