from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from uuid import uuid4

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from onholidai_agent.api.runs import RunService, router
from onholidai_agent.api.store import RunStore, WebRunStore
from onholidai_agent.config import Settings
from onholidai_agent.integrations.maps import MapsGroundingClient, MapsHttpTransport
from onholidai_agent.integrations.nebius import (
    DeterministicModel,
    NebiusClient,
    NebiusHttpTransport,
)
from onholidai_agent.integrations.runtime import EstimateSources
from onholidai_agent.integrations.tavily import TavilyClient, TavilyHttpTransport
from onholidai_agent.telemetry.langsmith import AddressedTraceClient, SafeLangSmithSink


def create_app(
    settings_factory: Callable[[], Settings] = Settings,
    store_factory: Callable[[httpx.AsyncClient, Settings], RunStore] | None = None,
) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncGenerator[None]:
        settings = settings_factory()
        async with AsyncExitStack() as resources:
            application.state.settings = settings
            application.state.resources = resources
            client = await resources.enter_async_context(
                httpx.AsyncClient(base_url=settings.web_base_url, timeout=8)
            )
            store = (
                store_factory(client, settings)
                if store_factory
                else WebRunStore(client, settings.service_token_secret)
            )
            model = NebiusClient(
                NebiusHttpTransport(client, settings.nebius_base_url, settings.nebius_api_key or "")
                if settings.provider_mode == "live"
                else DeterministicModel(),
                settings.nebius_model,
            )
            maps = (
                MapsGroundingClient(
                    MapsHttpTransport(client, settings.maps_grounding_api_key or "")
                )
                if settings.provider_mode == "live"
                else None
            )
            tavily = (
                TavilyClient(TavilyHttpTransport(client, settings.tavily_api_key or ""))
                if settings.provider_mode == "live"
                else None
            )
            sink = None
            if (
                settings.langsmith_tracing
                and settings.langsmith_api_key
                and not settings.langsmith_api_key.startswith("synthetic")
            ):
                from langsmith import Client

                trace_client = Client(
                    api_url=settings.langsmith_endpoint,
                    api_key=settings.langsmith_api_key,
                    timeout_ms=1000,
                    auto_batch_tracing=False,
                    omit_traced_runtime_info=True,
                )
                resources.callback(trace_client.close)
                sink = SafeLangSmithSink(AddressedTraceClient(trace_client), settings)
            application.state.runs = RunService(
                store, EstimateSources(store, model, maps, tavily), sink
            )
            try:
                yield
            finally:
                await application.state.runs.shutdown()
                del application.state.runs
                del application.state.settings
                del application.state.resources

    application = FastAPI(title="Onholidai Agent API", version="0.0.0", lifespan=lifespan)
    application.include_router(router)

    @application.exception_handler(RequestValidationError)
    async def invalid_request(_request: Request, _error: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {
                "type": "about:blank",
                "title": "Invalid request",
                "status": 422,
                "code": "validation_error",
                "correlationId": str(uuid4()),
            },
            status_code=422,
            media_type="application/problem+json",
        )

    @application.exception_handler(HTTPException)
    async def safe_http_error(_request: Request, error: HTTPException) -> JSONResponse:
        return JSONResponse(
            {
                "type": "about:blank",
                "title": "Request could not be completed",
                "status": error.status_code,
                "code": "request_rejected",
                "correlationId": str(uuid4()),
            },
            status_code=error.status_code,
            media_type="application/problem+json",
        )

    @application.get("/health", tags=["system"])
    async def health(request: Request) -> dict[str, str]:
        settings: Settings = request.app.state.settings
        return {"status": "ok", "providerMode": settings.provider_mode}

    @application.middleware("http")
    async def no_store(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers["Cache-Control"] = "private, no-store"
        return response

    return application


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("onholidai_agent.api.main:app", host="0.0.0.0", port=8000)
