"""Tests for the live student-dashboard inference (ui/live + its endpoints)."""

import joblib
import pandas as pd
import pytest

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402

from src.models.sequential import fit_discrete_hmm, state_sequences_by_session  # noqa: E402
from src.pipeline import prepare_features  # noqa: E402
from ui.app import create_app  # noqa: E402
from ui.sources import SOURCES  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(create_app()) as test_client:
        yield test_client


@pytest.fixture(scope="module")
def live_source(tmp_path_factory, synthetic_tables):
    """A temporary source with trained state + HMM artefacts to infer with."""
    root = tmp_path_factory.mktemp("live-source")
    (root / "models").mkdir(parents=True, exist_ok=True)
    (root / "features").mkdir(parents=True, exist_ok=True)

    prepared = prepare_features(synthetic_tables, window_seconds=60, n_states=3)
    joblib.dump(prepared["state_model"], root / "models" / "state_model.joblib")
    joblib.dump(prepared["scaler"], root / "models" / "state_scaler.joblib")

    sequences = state_sequences_by_session(prepared["features"])
    hmm = fit_discrete_hmm(list(sequences.values()), n_hidden=2, n_symbols=3, n_restarts=1)
    joblib.dump(hmm, root / "models" / "hmm_model.joblib")

    # Student-facing descriptors are derived from this table.
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

    SOURCES["live_test"] = {
        "label": "Live test source",
        "detail": "Temporary source used by the live-dashboard tests.",
        "root": root,
        "raw_dir": root / "raw",
        "synthetic": True,
    }
    yield "live_test"
    SOURCES.pop("live_test", None)


@pytest.fixture(scope="module")
def snapshots(synthetic_tables):
    """~2 minutes of one session's behaviour, in the push payload shape."""
    behavior = synthetic_tables["behavior_logs"]
    session_id = behavior["session_id"].iloc[0]
    rows = behavior[behavior["session_id"] == session_id].head(120)
    return session_id, [
        {
            "created_at": str(row["created_at"]),
            "keyboard_count": int(row["keyboard_count"]),
            "mouse_distance": float(row["mouse_distance"]),
            "mouse_clicks": int(row["mouse_clicks"]),
            "idle_time": float(row["idle_time"]),
            "active_application": str(row["active_application"]),
        }
        for _, row in rows.iterrows()
    ]


def _push(client, source, session_id, chunks):
    response = None
    for start in range(0, len(chunks), 40):
        response = client.post(
            "/api/live/push",
            json={
                "source": source,
                "participant_id": "P-live-test",
                "session_id": session_id,
                "context": "coding",
                "window_seconds": 60,
                "snapshots": chunks[start : start + 40],
            },
        )
    return response


# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------


def test_ready_reports_trained_artefacts(client, live_source):
    response = client.get("/api/live/ready", params={"source": live_source})
    assert response.status_code == 200
    body = response.json()
    assert body["ready"] is True
    assert body["n_states"] == 3
    assert body["hmm_model"]["available"] is True


def test_ready_rejects_unknown_source(client):
    assert client.get("/api/live/ready", params={"source": "nope"}).status_code == 404


def test_ready_reports_missing_models(client, tmp_path, monkeypatch):
    source = tmp_path / "bare-live"
    source.mkdir()
    monkeypatch.setitem(
        SOURCES,
        "bare_live",
        {"label": "Bare", "detail": "", "root": source, "raw_dir": source, "synthetic": True},
    )
    response = client.get("/api/live/ready", params={"source": "bare_live"})
    body = response.json()
    assert body["ready"] is False
    assert any("state_model" in item for item in body["missing"])


# ---------------------------------------------------------------------------
# Push -> readout
# ---------------------------------------------------------------------------


def test_push_returns_a_student_readout(client, live_source, snapshots):
    session_id, rows = snapshots
    response = _push(client, live_source, session_id, rows)
    assert response.status_code == 200, response.text
    insight = response.json()

    assert insight["ok"] is True
    assert insight["sessionId"] == session_id
    assert insight["participantId"] == "P-live-test"
    assert insight["windowSeconds"] == 60
    assert insight["snapshotCount"] >= 1

    # The trained state model produced a state + a human descriptor.
    assert insight["currentState"] is not None
    assert "typing" in insight["currentStateDescriptor"]

    shares = insight["stateShares"]
    assert len(shares) == 3
    assert abs(sum(entry["share"] for entry in shares) - 1.0) < 1e-6
    assert all("descriptor" in entry for entry in shares)

    # The trained HMM decoded the observed-state sequence.
    assert insight["regime"] is not None
    assert insight["regime"]["nHidden"] == 2
    assert 0.0 <= insight["regime"]["confidence"] <= 1.0

    assert insight["timeline"]
    assert insight["transitions"]["dominantState"] is not None
    assert insight["model"]["source"] == live_source
    assert insight["model"]["hmmAvailable"] is True


def test_push_accumulates_across_calls(client, live_source, snapshots):
    session_id, rows = snapshots
    first = _push(client, live_source, session_id, rows[:40]).json()
    second = _push(client, live_source, session_id, rows[:80]).json()
    assert second["snapshotCount"] >= first["snapshotCount"]
    assert second["windows"] >= first["windows"]


def test_single_snapshot_is_reported_as_warming_up(client, live_source, snapshots):
    session_id, rows = snapshots
    response = client.post(
        "/api/live/push",
        json={
            "source": live_source,
            "participant_id": "P-live-test",
            "session_id": f"{session_id}-warm",
            "snapshots": rows[:1],
        },
    )
    assert response.status_code == 400
    assert "warming up" in response.json()["detail"].lower()


def test_push_validates_identifiers(client, live_source):
    response = client.post(
        "/api/live/push",
        json={"source": live_source, "participant_id": "", "session_id": "s", "snapshots": []},
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# State retrieval + clearing
# ---------------------------------------------------------------------------


def test_state_round_trip_and_clear(client, live_source, snapshots):
    session_id, rows = snapshots
    _push(client, live_source, session_id, rows)

    state = client.get("/api/live/state", params={"session_id": session_id})
    assert state.status_code == 200
    assert state.json()["insight"]["sessionId"] == session_id

    cleared = client.delete("/api/live/session", params={"session_id": session_id})
    assert cleared.json() == {"ok": True, "cleared": True}
    assert client.get("/api/live/state", params={"session_id": session_id}).status_code == 404


def test_state_missing_session_is_404(client):
    assert client.get("/api/live/state", params={"session_id": "does-not-exist"}).status_code == 404
