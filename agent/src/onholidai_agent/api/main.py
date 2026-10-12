from collections.abc import AsyncIterator, Callable
from contextlib import AsyncExitStack, asynccontextmanager

from fastapi import FastAPI, Request

from onholidai_agent.config import Settings


def create_app(settings_factory: Callable[[], Settings] = Settings) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncIterator[None]:
        settings = settings_factory()
        async with AsyncExitStack() as resources:
            application.state.settings = settings
            application.state.resources = resources
            try:
                yield
            finally:
                del application.state.settings
                del application.state.resources

    application = FastAPI(title="Onholidai Agent API", version="0.0.0", lifespan=lifespan)

    @application.get("/health", tags=["system"])
    async def health(request: Request) -> dict[str, str]:
        settings: Settings = request.app.state.settings
        return {"status": "ok", "providerMode": settings.provider_mode}

    return application


app = create_app()


def run() -> None:
    import uvicorn

    uvicorn.run("onholidai_agent.api.main:app", host="0.0.0.0", port=8000)
