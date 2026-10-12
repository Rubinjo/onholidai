from fastapi import FastAPI

from onholidai_agent.config import settings

app = FastAPI(title="Onholidai Agent API", version="0.0.0")


@app.get("/health", tags=["system"])
async def health() -> dict[str, str]:
    return {"status": "ok", "providerMode": settings.provider_mode}


def run() -> None:
    import uvicorn

    uvicorn.run("onholidai_agent.api.main:app", host="0.0.0.0", port=8000)
