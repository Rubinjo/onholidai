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
