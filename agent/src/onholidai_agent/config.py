from typing import Literal, Self

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)

    provider_mode: Literal["deterministic", "live"] = "deterministic"
    environment: Literal["development", "test", "production"] = "development"
    web_base_url: str = "http://localhost:3000"
    service_token_secret: str = "synthetic-local-service-secret-000000000"
    nebius_base_url: str = "https://api.studio.nebius.ai/v1"
    nebius_api_key: str | None = None
    nebius_model: str = "synthetic-model"
    maps_grounding_api_key: str | None = None
    tavily_api_key: str | None = None
    langsmith_api_key: str | None = None
    otel_exporter_otlp_endpoint: str | None = None

    @model_validator(mode="after")
    def require_live_credentials(self) -> Self:
        if len(self.service_token_secret.encode()) < 32:
            raise ValueError("Service token secret must contain at least 32 bytes")
        if self.environment == "production" and self.service_token_secret.startswith("synthetic"):
            raise ValueError("Production requires explicit scoped service signing credentials")
        if self.provider_mode == "live":
            required = {
                "nebius_api_key": self.nebius_api_key,
                "maps_grounding_api_key": self.maps_grounding_api_key,
                "tavily_api_key": self.tavily_api_key,
            }
            missing = [name for name, value in required.items() if not value]
            if missing:
                raise ValueError(f"Missing live-provider settings: {', '.join(missing)}")
        return self
