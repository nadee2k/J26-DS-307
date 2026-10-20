"""Tests for the demo UI API layer (FastAPI + artifact access)."""

import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from ui.app import create_app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


def test_index_serves_the_app_shell(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "FocusTrack" in response.text
    assert "tab-integration" in response.text


def test_session_demo_serves_a_standalone_page(client):
    response = client.get("/session-demo")
    assert response.status_code == 200
    assert "Start session" in response.text
    assert "End session" in response.text
    assert "Load sample session" in response.text


def test_static_assets_are_served(client):
    for asset in ("app.js", "style.css", "session-demo.js"):
        response = client.get(f"/static/{asset}")
        assert response.status_code == 200
        assert len(response.text) > 500


def test_sources_lists_both_data_sources(client):
    sources = client.get("/api/sources").json()
    assert [s["id"] for s in sources] == ["real", "synthetic"]
    assert all({"label", "detail", "root", "artifacts", "ready"} <= set(s) for s in sources)


def test_schema_exposes_the_declared_fields(client):
    payload = client.get("/api/schema").json()
    assert payload["integration_version"]
    assert "behavioural_summary" in payload["session"]
    assert "interaction_state" in payload["window"]


def test_overview_requires_a_known_source(client):
    assert client.get("/api/overview", params={"source": "nope"}).status_code == 404


def test_table_payload_shape(client):
    payload = client.get("/api/tables/features", params={"source": "real", "limit": 5}).json()
    assert set(payload) == {"columns", "rows", "total", "exists", "path"}
    assert len(payload["rows"]) <= 5
    if payload["exists"]:
        assert payload["total"] >= len(payload["rows"])


def test_unknown_table_is_404(client):
    assert client.get("/api/tables/definitely_not_an_artifact").status_code == 404


def test_unknown_json_artifact_is_404(client):
    assert client.get("/api/json/definitely_not_an_artifact").status_code == 404


def test_status_reports_a_single_flight_runner(client):
    status = client.get("/api/status").json()
    assert status["running"] is False
    assert status["stage"] == "idle"
    assert isinstance(status["log"], list)


def test_run_rejects_unknown_source(client):
    response = client.post("/api/run", json={"source": "nope"})
    assert response.status_code == 404
