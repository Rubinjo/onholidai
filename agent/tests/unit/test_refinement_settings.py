import pytest
from pydantic import ValidationError

from onholidai_agent.config import Settings


def test_eu_tracing_settings_and_token_factory_default():
    settings = Settings(langsmith_api_key="synthetic-key", langsmith_tracing=True)
    assert settings.nebius_base_url == "https://api.tokenfactory.nebius.com/v1"
    assert settings.langsmith_endpoint == "https://eu.api.smith.langchain.com"
    assert settings.langsmith_agent_id == "onholidai"
    assert settings.langsmith_agent_environment == "local"


def test_live_tracing_rejects_placeholder_credentials():
    with pytest.raises(ValidationError, match="LangSmith"):
        Settings(provider_mode="live", langsmith_tracing=True, langsmith_api_key="synthetic-key")


def test_production_accepts_long_synthetic_service_token_secret():
    settings = Settings(
        environment="production",
        service_token_secret="synthetic-local-service-secret-000000000",
    )
    assert settings.service_token_secret == "synthetic-local-service-secret-000000000"


def test_production_still_requires_a_long_service_token_secret():
    with pytest.raises(ValidationError, match="32 bytes"):
        Settings(environment="production", service_token_secret="synthetic-short")
