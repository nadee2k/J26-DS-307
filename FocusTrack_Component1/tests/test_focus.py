"""Tests for the focus dashboard aggregation (ui/focus + its endpoints)."""

import pandas as pd
import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from src.pipeline import prepare_features  # noqa: E402
from src.transitions.transition_model import session_transition_summary  # noqa: E402
from ui import focus  # noqa: E402
from ui.app import create_app  # noqa: E402
from ui.sources import SOURCES  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def focus_source(tmp_path_factory, synthetic_tables):
    """A temporary source with the per-session artifacts the dashboard reads."""
    root = tmp_path_factory.mktemp("focus-source")
    (root / "features").mkdir(parents=True, exist_ok=True)
    (root / "results").mkdir(parents=True, exist_ok=True)

    prepared = prepare_features(synthetic_tables, window_seconds=60, n_states=3)
    features = prepared["features"]
    features.to_csv(root / "features" / "features.csv", index=False)

    session_transition_summary(features).to_csv(
        root / "results" / "session_transitions.csv", index=False
    )

    session_ids = sorted(features["session_id"].astype(str).unique().tolist())
    pd.DataFrame(
        [
            {
                "session_id": session_id,
                "hmm__log_likelihood": -12.5,
                "hmm__mean_dwell": 2.5,
                "hmm__transition_entropy": 0.3,
                "hmm__dominant": 0,
                "hmm__share_0": 0.5,
                "hmm__share_1": 0.3,
                "hmm__share_2": 0.2,
            }
            for session_id in session_ids
        ]
    ).to_csv(root / "results" / "hmm_session_features.csv", index=False)

    rated = session_ids[:2]
    pd.DataFrame(
        [
            {
                "session_id": session_id,
                "concentration_mean": 4.0 if index == 0 else 2.0,
                "n_ratings": 2,
                "concentration_label": 4,
                "concentration_binary": 1,
            }
            for index, session_id in enumerate(rated)
        ]
    ).to_csv(root / "features" / "session_dataset.csv", index=False)

    pd.DataFrame(
        [
            {
                "state": state,
                "typing_rate_level": "High",
                "mean_mouse_velocity_level": "Low",
                "idle_ratio_level": "Low",
                "application_switch_frequency_level": "Medium",
            }
            for state in range(3)
        ]
    ).to_csv(root / "features" / "state_profiles.csv", index=False)

    SOURCES["focus_test"] = {
        "label": "Focus test source",
        "detail": "Temporary source used by the focus dashboard tests.",
        "root": root,
        "raw_dir": root / "raw",
        "synthetic": True,
    }
    yield "focus_test", features, len(rated)
    SOURCES.pop("focus_test", None)


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def test_totals_match_the_feature_table(focus_source):
    source, features, rated = focus_source
    payload = focus.build(source)
    assert payload["nStates"] == 3
    assert payload["totals"]["sessions"] == features["session_id"].nunique()
    assert payload["totals"]["windows"] == len(features)
    assert payload["totals"]["participants"] == features["participant_id"].nunique()
    assert payload["totals"]["withConcentration"] == rated
    assert len(payload["sessions"]) == features["session_id"].nunique()


def test_sessions_are_chronological_with_described_states(focus_source):
    source, _, _ = focus_source
    payload = focus.build(source)
    starts = [session["startedAt"] for session in payload["sessions"]]
    assert starts == sorted(starts)
    for session in payload["sessions"]:
        assert session["sequence"], "every analysed session keeps its state sequence"
        total = sum(entry["share"] for entry in session["stateShares"])
        assert abs(total - 1.0) < 1e-6
        assert "typing" in session["dominantDescriptor"]
        assert session["dominantShare"] is not None


def test_hmm_regime_and_concentration_are_attached(focus_source):
    source, _, rated = focus_source
    payload = focus.build(source)
    assert all(session["hmmRegime"] == 0 for session in payload["sessions"])
    with_rating = [s for s in payload["sessions"] if s["concentrationMean"] is not None]
    assert len(with_rating) == rated
    assert any("concentration is available" in note for note in payload["notes"])


def test_empty_source_is_reported_cleanly(tmp_path, monkeypatch):
    root = tmp_path / "empty-focus"
    root.mkdir()
    monkeypatch.setitem(
        SOURCES,
        "empty_focus",
        {"label": "Empty", "detail": "", "root": root, "raw_dir": root, "synthetic": True},
    )
    payload = focus.build("empty_focus")
    assert payload["sessions"] == []
    assert payload["states"] == []
    assert payload["totals"]["sessions"] == 0
    assert payload["notes"]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


def test_focus_endpoint_returns_the_payload(client, focus_source):
    source, _, _ = focus_source
    response = client.get("/api/focus", params={"source": source})
    assert response.status_code == 200
    body = response.json()
    assert body["source"] == source
    assert body["totals"]["sessions"] > 0
    assert body["sessions"][0]["sessionId"]


def test_focus_page_is_served(client):
    response = client.get("/focus")
    assert response.status_code == 200
    assert "Focus dashboard" in response.text
    assert "/static/focus.js" in response.text


def test_focus_endpoint_rejects_unknown_source(client):
    assert client.get("/api/focus", params={"source": "nope"}).status_code == 404
