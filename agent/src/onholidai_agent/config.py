from typing import Literal, Self

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    provider_mode: Literal["deterministic", "live"] = "deterministic"
    environment: Literal["development", "test", "production"] = "development"
    web_base_url: str = "http://localhost:3000"
    service_token_secret: str = "synthetic-local-service-secret-000000000"
    nebius_base_url: str = "https://api.tokenfactory.nebius.com/v1"
    nebius_api_key: str | None = None
    nebius_model: str = "synthetic-model"
    nebius_max_output_tokens: int = Field(default=4096, ge=512, le=8192)
    nebius_request_timeout_seconds: float = Field(default=90, ge=8, le=300)
    maps_grounding_api_key: str | None = None
    tavily_api_key: str | None = None
    langsmith_api_key: str | None = None
    langsmith_tracing: bool = False
    langsmith_endpoint: str = "https://eu.api.smith.langchain.com"
    langsmith_agent_id: str = "onholidai"
    langsmith_agent_environment: str = "local"
    otel_exporter_otlp_endpoint: str | None = None

    @model_validator(mode="after")
    def require_live_credentials(self) -> Self:
        if (
            self.langsmith_tracing
            and (not self.langsmith_api_key or self.langsmith_api_key.startswith("synthetic"))
            and (self.environment == "production" or self.provider_mode == "live")
        ):
            raise ValueError("LangSmith tracing requires an explicit API key")
        if not self.langsmith_endpoint.startswith("https://"):
            raise ValueError("LangSmith endpoint must use HTTPS")
        if len(self.service_token_secret.encode()) < 32:
            raise ValueError("Service token secret must contain at least 32 bytes")
        if self.provider_mode == "live":
            required = {
                "nebius_api_key": self.nebius_api_key,
                "nebius_model": self.nebius_model,
                "maps_grounding_api_key": self.maps_grounding_api_key,
                "tavily_api_key": self.tavily_api_key,
            }
            missing = [
                name
                for name, value in required.items()
                if not value or value.startswith("synthetic")
            ]
            if missing:
                raise ValueError(f"Missing live-provider settings: {', '.join(missing)}")
        return self
