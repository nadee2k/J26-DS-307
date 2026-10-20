"""Tests for the behaviour-inferred learning type (screen vs non-screen)."""

import pandas as pd
import pytest

from src.analysis.learning_type import (
    ACTIVITY_FEATURES,
    BEHAVIOUR_FEATURES,
    classify_learning_type,
    participant_profile,
)

SCREEN_IDS = [f"active-{i}" for i in range(3)]
NON_SCREEN_IDS = [f"idle-{i}" for i in range(3)]


def _user(participant_id: str, typing: float, keys: float, clicks: float, n: int = 4) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "participant_id": participant_id,
            "session_id": [f"s-{participant_id}"] * n,
            "context": ["coding"] * n,
            "typing_rate": typing,
            "key_event_count": keys,
            "mouse_distance": keys * 5,
            "mouse_clicks": clicks,
            "application_switch_count": 1.0,
            "unique_application_count": 2.0,
            "window_index": list(range(n)),
        }
    )


@pytest.fixture()
def features() -> pd.DataFrame:
    active = [_user(pid, typing=2.0, keys=100.0, clicks=30.0) for pid in SCREEN_IDS]
    idle = [_user(pid, typing=0.1, keys=2.0, clicks=1.0) for pid in NON_SCREEN_IDS]
    return pd.concat(active + idle, ignore_index=True)


def test_profile_aggregates_windows_per_participant(features):
    profile = participant_profile(features)

    assert len(profile) == 6
    assert set(profile["participant_id"]) == set(SCREEN_IDS + NON_SCREEN_IDS)
    row = profile.set_index("participant_id").loc[SCREEN_IDS[0]]
    assert row["typing_rate"] == pytest.approx(2.0)
    assert row["n_windows"] == 4
    assert row["n_sessions"] == 1
    assert 0.0 <= row["active_window_share"] <= 1.0


def test_profile_of_empty_frame_is_empty():
    assert participant_profile(pd.DataFrame()).empty


def test_classification_separates_active_from_idle(features):
    payload = classify_learning_type(features)

    assert payload["ok"] is True
    decision = {p["participant_id"]: p["inferred_learning_type"] for p in payload["participants"]}
    assert all(decision[pid] == "screen" for pid in SCREEN_IDS)
    assert all(decision[pid] == "non-screen" for pid in NON_SCREEN_IDS)


def test_screen_scores_are_bounded_and_ordered(features):
    payload = classify_learning_type(features)
    screen = [p["screen_score"] for p in payload["participants"] if p["inferred_learning_type"] == "screen"]
    other = [p["screen_score"] for p in payload["participants"] if p["inferred_learning_type"] == "non-screen"]

    assert all(0.0 <= s <= 1.0 for s in screen + other)
    assert min(screen) > max(other)


def test_groups_report_mean_metrics(features):
    payload = classify_learning_type(features)
    groups = {g["learning_type"]: g for g in payload["groups"]}

    assert set(groups) == {"screen", "non-screen"}
    assert groups["screen"]["participants"] == 3
    assert groups["non-screen"]["metrics"]["typing_rate"] < groups["screen"]["metrics"]["typing_rate"]


def test_classification_is_deterministic(features):
    first = classify_learning_type(features)
    second = classify_learning_type(features)
    assert first["participants"] == second["participants"]
    assert first["groups"] == second["groups"]


def test_meta_documents_the_method(features):
    meta = classify_learning_type(features)["meta"]
    assert meta["level"] == "participant"
    assert "KMeans" in meta["method"]
    assert set(meta["features_used"]) <= set(ACTIVITY_FEATURES)
    assert set(meta["features_reported"]) <= set(BEHAVIOUR_FEATURES)
    assert isinstance(meta["random_state"], int)


def test_recorded_labels_are_only_compared_afterwards(features):
    recording = {pid: "screen" for pid in SCREEN_IDS}
    recording.update({pid: "non-screen" for pid in NON_SCREEN_IDS})
    recording["idle-0"] = "screen"  # deliberate mismatch on one participant

    agreement = classify_learning_type(features, recorded=recording)["meta"]["recorded_agreement"]
    assert agreement["n_labelled"] == 6
    assert agreement["agreement_rate"] == pytest.approx(5 / 6, abs=5e-4)
    assert "not used to fit" in agreement["note"]


def test_recorded_labels_ignore_unknown_participants(features):
    recording = {"someone-else": "screen"}
    agreement = classify_learning_type(features, recorded=recording)["meta"]["recorded_agreement"]
    assert agreement is None


def test_missing_features_explains_itself():
    payload = classify_learning_type(pd.DataFrame())
    assert payload["ok"] is False
    assert payload["participants"] == []
    assert "participant_id" in payload["reason"]


def test_single_participant_cannot_be_clustered(features):
    payload = classify_learning_type(features[features["participant_id"] == SCREEN_IDS[0]])
    assert payload["ok"] is False
    assert "two participants" in payload["reason"]


def test_identical_behaviour_is_reported_not_invented(features):
    flat = features.copy()
    for col in BEHAVIOUR_FEATURES:
        if col in flat.columns:
            flat[col] = 1.0
    payload = classify_learning_type(flat)
    assert payload["ok"] is False
    assert "identical" in payload["reason"]


def test_learning_type_endpoint_shape():
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient

    from ui.app import create_app

    with TestClient(create_app()) as client:
        payload = client.get("/api/analysis/learning-type", params={"source": "real"}).json()
        assert client.get("/api/analysis/learning-type", params={"source": "nope"}).status_code == 404

    assert payload["source"] == "real"
    assert {"ok", "meta", "participants", "groups", "label"} <= set(payload)
    if payload["ok"]:
        assert all({"participant_id", "inferred_learning_type", "screen_score"} <= set(p)
                   for p in payload["participants"])
