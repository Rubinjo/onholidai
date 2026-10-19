"""Per-request, in-memory supplier reads; web remains the inventory authority."""

import asyncio
import json
from collections.abc import Awaitable, Callable
from functools import lru_cache
from pathlib import Path
from typing import Any, cast

import httpx
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from fastmcp.tools import Tool, ToolResult
from jsonschema import Draft202012Validator  # pyright: ignore[reportMissingTypeStubs]
from mcp.types import ToolAnnotations
from pydantic import PrivateAttr, ValidationError

from onholidai_agent.api.store import RunStore
from onholidai_agent.models.api import CreateAgentRunRequest
from onholidai_agent.models.tools import (
    SUPPLIER_TOOL_INPUTS,
    SupplierCapabilitiesInput,
    SupplierOfferInput,
    SupplierSearchInput,
)

type ReadHandler = Callable[[dict[str, object]], Awaitable[dict[str, object]]]


@lru_cache(maxsize=1)
def public_offer_validator() -> Draft202012Validator:
    path = Path(__file__).resolve().parents[4] / "contracts/supply/public-offers-v1.schema.json"
    return Draft202012Validator(json.loads(path.read_text(encoding="utf-8")))


def validate_output(name: str, result: dict[str, object]) -> dict[str, object]:
    if len(json.dumps(result, allow_nan=False).encode()) > 262144:
        raise ValueError("supplier_output_budget")
    offers: list[object] = []
    if name == "supplier_offer_details" and result.get("outcome") not in (
        "available", "expired", "unchanged", "changed", "unknown", "unavailable", "unsupported",
    ):
        raise ValueError("supplier_output_invalid")
    if (
        name == "supplier_offer_details"
        and result.get("outcome") in ("available", "unchanged", "changed")
        and result.get("offer") is None
    ):
        raise ValueError("supplier_output_invalid")
    if name == "supplier_revalidate_offer":
        outcome = result.get("outcome")
        if outcome not in (
            "unchanged", "changed", "unavailable", "expired", "unsupported", "unknown",
        ):
            raise ValueError("supplier_output_invalid")
        differences = result.get("differences")
        if not isinstance(differences, list):
            raise ValueError("supplier_output_invalid")
        changes = cast(list[object], differences)
        if len(changes) > 64 or any(
            not isinstance(item, str) or len(item) > 1000 for item in changes
        ):
            raise ValueError("supplier_output_invalid")
        if outcome in ("unchanged", "changed") and result.get("offer") is None:
            raise ValueError("supplier_output_invalid")
    if name == "supplier_capabilities":
        capabilities = result.get("capabilities")
        if not isinstance(capabilities, list):
            raise ValueError("supplier_output_invalid")
    if name == "supplier_search":
        raw = result.get("offers")
        if not isinstance(raw, list):
            raise ValueError("supplier_output_invalid")
        offers = cast(list[object], raw)
        if len(offers) > 32:
            raise ValueError("supplier_output_invalid")
    elif result.get("offer") is not None:
        offers = [result["offer"]]
    elif "component" in result:
        offers = [result]
    for offer in offers:
        public_offer_validator().validate(offer)  # pyright: ignore[reportUnknownMemberType]
    return result


class SupplierReadTool(Tool):
    _read: ReadHandler = PrivateAttr()

    def __init__(self, name: str, read: ReadHandler):
        super().__init__(
            name=name,
            description="Read supplier evidence in this run's authorized planning scope.",
            parameters=SUPPLIER_TOOL_INPUTS[name].model_json_schema(by_alias=True),
            annotations=ToolAnnotations(
                read_only_hint=True, destructive_hint=False, open_world_hint=False,
            ),
        )
        self._read = read

    async def run(self, arguments: dict[str, Any]) -> ToolResult:
        try:
            # Custom tools validate raw protocol arguments, before any coercion.
            parsed = SUPPLIER_TOOL_INPUTS[self.name].model_validate(arguments, strict=True)
            async with asyncio.timeout(12):
                result = await self._read(parsed.model_dump(
                    mode="json", by_alias=True, exclude_none=True, exclude_unset=True,
                ))
            return ToolResult(structured_content=validate_output(self.name, result))
        except ValidationError:
            raise ToolError("invalid_supplier_arguments") from None
        except httpx.HTTPStatusError as error:
            code = error.response.status_code
            raise ToolError(
                "supplier_access_denied" if code in (401, 403, 404)
                else "supplier_stale" if code == 409 else "supplier_read_unavailable"
            ) from None
        except (ValueError, httpx.HTTPError, TimeoutError):
            raise ToolError("supplier_read_unavailable") from None
        except Exception:
            # Neither schema violations nor upstream private bodies reach the model.
            raise ToolError("supplier_output_invalid") from None


def supplier_server(store: RunStore, request: CreateAgentRunRequest) -> FastMCP:
    captured = request.model_copy(deep=True)
    server = FastMCP("onholidai-suppliers")

    async def search(arguments: dict[str, object]) -> dict[str, object]:
        query = SupplierSearchInput.model_validate(arguments)
        return await store.search(captured.model_copy(deep=True), query.model_dump(
            mode="json", by_alias=True, exclude_none=True, exclude_unset=True,
        ))

    async def details(arguments: dict[str, object]) -> dict[str, object]:
        ref = SupplierOfferInput.model_validate(arguments)
        return await store.offer_details(
            captured.model_copy(deep=True), ref.offer_ref, ref.revision,
        )

    async def revalidate(arguments: dict[str, object]) -> dict[str, object]:
        ref = SupplierOfferInput.model_validate(arguments)
        return await store.revalidate_offer(
            captured.model_copy(deep=True), ref.offer_ref, ref.revision,
        )

    async def capabilities(arguments: dict[str, object]) -> dict[str, object]:
        filters = SupplierCapabilitiesInput.model_validate(arguments)
        types = list[str](filters.component_types) if filters.component_types else None
        return await store.capabilities(captured.model_copy(deep=True), types)

    for name, handler in (
        ("supplier_search", search), ("supplier_offer_details", details),
        ("supplier_revalidate_offer", revalidate), ("supplier_capabilities", capabilities),
    ):
        server.add_tool(SupplierReadTool(name, handler))
    return server
