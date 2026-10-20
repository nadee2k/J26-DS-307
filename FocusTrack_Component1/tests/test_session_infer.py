"""Tests for the single-session analyzer (ui/session_infer + its endpoints)."""

import io

import joblib
import pandas as pd
import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from src.pipeline import prepare_features  # noqa: E402
from ui import session_infer  # noqa: E402
from ui.app import create_app  # noqa: E402
from ui.sources import SOURCES  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def session_csv(synthetic_tables):
    """One session's behaviour events as an uploaded CSV would look."""
    behavior = synthetic_tables["behavior_logs"]
    session_id = behavior["session_id"].iloc[0]
    payload = behavior[behavior["session_id"] == session_id].to_csv(index=False)
    return session_id, payload.encode()


@pytest.fixture(scope="module")
def inference_source(tmp_path_factory, synthetic_tables):
    """A temporary source whose trained state artefacts the analyzer can load."""
    root = tmp_path_factory.mktemp("analyzer-source")
    (root / "models").mkdir(parents=True, exist_ok=True)
    prepared = prepare_features(synthetic_tables, window_seconds=60, n_states=3)
    joblib.dump(prepared["state_model"], root / "models" / "state_model.joblib")
    joblib.dump(prepared["scaler"], root / "models" / "state_scaler.joblib")

    SOURCES["analyzer_test"] = {
        "label": "Analyzer test source",
        "detail": "Temporary source used by the session analyzer tests.",
        "root": root,
        "raw_dir": root / "raw",
        "synthetic": True,
    }
    yield "analyzer_test"
    SOURCES.pop("analyzer_test", None)


@pytest.fixture(scope="module")
def analyzer_client(client, inference_source):
    return client


# ---------------------------------------------------------------------------
# Inference helpers
# ---------------------------------------------------------------------------


def test_ready_reports_missing_model_for_unknown_artifacts(tmp_path, monkeypatch):
    from ui import sources as sources_mod

    root = tmp_path / "bare"
    root.mkdir()
    monkeypatch.setitem(
        sources_mod.SOURCES,
        "bare_test",
        {"label": "Bare", "detail": "", "root": root, "raw_dir": root, "synthetic": True},
    )
    state = session_infer.ready("bare_test")
    assert state["ready"] is False
    assert "state_model" in state["missing"][0]
    assert "Run the pipeline" in state["message"]


def test_normalize_requires_a_timestamp():
    with pytest.raises(session_infer.SessionAnalysisError, match="timestamp"):
        session_infer.normalize_events(pd.DataFrame({"session_id": ["s"], "keyboard_count": [1]}))


def test_normalize_requires_a_session_id():
    frame = pd.DataFrame({"created_at": ["2026-01-01T09:00:00Z"], "keyboard_count": [1]})
    with pytest.raises(session_infer.SessionAnalysisError, match="session_id"):
        session_infer.normalize_events(frame)


def test_normalize_filters_to_the_requested_session():
    frame = pd.DataFrame(
        {
            "created_at": ["2026-01-01T09:00:00Z", "2026-01-01T10:00:00Z"],
            "session_id": ["S1", "S2"],
            "keyboard_count": [1, 2],
        }
    )
    out, meta = session_infer.normalize_events(frame, session_id="S2")
    assert out["session_id"].tolist() == ["S2"]
    assert meta["session_id"] == "S2"

    with pytest.raises(session_infer.SessionAnalysisError, match="S1"):
        session_infer.normalize_events(frame, session_id="S3")


def test_sample_csv_has_the_expected_columns():
    csv_text, filename, origin = session_infer.sample_events("real")
    assert "created_at" in csv_text.splitlines()[0]
    assert "session_id" in csv_text.splitlines()[0]
    assert filename.endswith(".csv")
    assert origin in ("real", "synthetic", "inline")
    parsed = pd.read_csv(io.StringIO(csv_text))
    assert not parsed.empty


# ---------------------------------------------------------------------------
# End-to-end analysis
# ---------------------------------------------------------------------------


def test_analyze_returns_the_component_outputs(analyzer_client, inference_source, session_csv):
    session_id, payload = session_csv
    response = analyzer_client.post(
        "/api/session/analyze",
        files={"file": ("session.csv", payload, "text/csv")},
        data={"source": inference_source, "participant_id": "P-test", "context": "coding"},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["ok"] is True
    assert body["meta"]["session_id"] == session_id
    assert body["meta"]["participant_id"] == "P-test"
    assert body["meta"]["context"] == "coding"
    assert body["meta"]["n_windows"] > 1

    # Window-level contract
    assert body["window_integration"], "expected window integration rows"
    from src.integration.export import SESSION_OUTPUT_SCHEMA, WINDOW_OUTPUT_SCHEMA

    assert set(WINDOW_OUTPUT_SCHEMA) <= set(body["window_integration"][0])
    assert body["validation"]["window"] == []

    # Session-level contract
    assert set(SESSION_OUTPUT_SCHEMA) <= set(body["session_integration"])
    assert body["validation"]["session"] == []
    assert body["session_integration"]["session_duration_seconds"] > 0
    assert body["session_summary"]["behavioural_summary"]

    # Timeline / shares / transitions line up with the trained state count
    assert len(body["timeline"]) == body["meta"]["n_windows"]
    assert sum(entry["windows"] for entry in body["state_shares"]) == body["meta"]["n_windows"]
    assert len(body["transitions"]["matrix"]) == body["meta"]["states"]

    # Downloads
    for kind, url in body["download"].items():
        assert kind in ("session_csv", "window_csv")
        download = analyzer_client.get(url)
        assert download.status_code == 200
        assert "session_id" in download.text.splitlines()[0]


def test_analyze_rejects_a_multi_session_file(analyzer_client, inference_source, synthetic_tables):
    payload = synthetic_tables["behavior_logs"].head(2000).to_csv(index=False).encode()
    response = analyzer_client.post(
        "/api/session/analyze",
        files={"file": ("mixed.csv", payload, "text/csv")},
        data={"source": inference_source},
    )
    assert response.status_code == 400
    assert "sessions" in response.json()["detail"]


def test_analyze_rejects_a_file_without_timestamps(analyzer_client, inference_source):
    payload = b"session_id,keyboard_count\nS1,3\n"
    response = analyzer_client.post(
        "/api/session/analyze",
        files={"file": ("bad.csv", payload, "text/csv")},
        data={"source": inference_source, "session_id": "S1"},
    )
    assert response.status_code == 400
    assert "timestamp" in response.json()["detail"].lower()


def test_analyze_requires_a_trained_model(client, session_csv):
    _session_id, payload = session_csv
    response = client.post(
        "/api/session/analyze",
        files={"file": ("session.csv", payload, "text/csv")},
        data={"source": "synthetic"},
    )
    # The synthetic source may or may not have artefacts on this machine; the
    # endpoint must answer 200 or 409, never 500.
    assert response.status_code in (200, 409)
    if response.status_code == 409:
        assert "pipeline" in response.json()["detail"].lower()


def test_ready_and_sample_endpoints(analyzer_client, inference_source):
    ready = analyzer_client.get("/api/session/analyze/ready", params={"source": inference_source})
    assert ready.status_code == 200
    assert ready.json()["ready"] is True
    assert ready.json()["n_states"] == 3

    assert analyzer_client.get(
        "/api/session/analyze/ready", params={"source": "nope"}
    ).status_code == 404

    sample = analyzer_client.get("/api/session/sample", params={"source": inference_source})
    assert sample.status_code == 200
    assert sample.headers["content-type"].startswith("text/csv")
    assert "created_at" in sample.text.splitlines()[0]


def test_download_rejects_unknown_keys(analyzer_client):
    assert analyzer_client.get(
        "/api/session/download/session", params={"key": "does-not-exist"}
    ).status_code == 404
    assert analyzer_client.get(
        "/api/session/download/nope", params={"key": "x"}
    ).status_code == 404


def test_shell_lists_the_new_tab(client):
    html = client.get("/").text
    assert "tab-session-analyzer" in html
    assert "session.js" in html
