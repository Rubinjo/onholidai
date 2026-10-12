from fastapi.testclient import TestClient

from onholidai_agent.api.main import create_app
from onholidai_agent.config import Settings


def test_health_reports_deterministic_provider_mode() -> None:
    app = create_app(lambda: Settings(provider_mode="deterministic"))
    with TestClient(app) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "providerMode": "deterministic"}


def test_settings_are_loaded_at_startup_and_released_at_shutdown() -> None:
    calls: list[str] = []

    def settings_factory() -> Settings:
        calls.append("startup")
        return Settings(provider_mode="deterministic")

    app = create_app(settings_factory)
    assert calls == []
    with TestClient(app) as client:
        assert calls == ["startup"]
        app.state.resources.callback(calls.append, "shutdown")
        assert client.get("/health").status_code == 200
    assert calls == ["startup", "shutdown"]
    assert not hasattr(app.state, "settings")


def test_failed_configuration_prevents_startup() -> None:
    import pytest

    def invalid_settings() -> Settings:
        raise ValueError("Invalid synthetic configuration")

    app = create_app(invalid_settings)
    with pytest.raises(ValueError, match="Invalid synthetic configuration"), TestClient(app):
        pass
