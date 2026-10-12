from fastapi.testclient import TestClient

from onholidai_agent.api.main import app


def test_health_reports_deterministic_provider_mode() -> None:
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "providerMode": "deterministic"}