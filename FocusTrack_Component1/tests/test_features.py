import numpy as np
import pandas as pd

from src.features.feature_builder import attach_focus_reference, build_window_features


def test_attach_focus_reference_has_single_column():
    windows = pd.DataFrame(
        {
            "participant_id": ["p"] * 4,
            "session_id": ["s"] * 4,
            "window_start": pd.date_range("2026-09-01T08:00:00Z", periods=4, freq="60s"),
        }
    )
    concentration = pd.DataFrame(
        [
            {"session_id": "s", "level": 2, "recorded_at": "2026-09-01T08:00:30Z"},
            {"session_id": "s", "level": 5, "recorded_at": "2026-09-01T08:02:30Z"},
        ]
    )
    out = attach_focus_reference(windows, concentration, method="locf")
    assert "focus_reference" in out.columns
    assert "focus_reference_x" not in out.columns
    assert "focus_reference_y" not in out.columns
    # LOCF: nothing precedes the first report; the value is carried forward.
    values = out["focus_reference"].tolist()
    assert pd.isna(values[0])
    assert values[1:] == [2, 2, 5]


def test_attach_focus_reference_session_method():
    windows = pd.DataFrame(
        {
            "participant_id": ["p"] * 2,
            "session_id": ["s"] * 2,
            "window_start": pd.date_range("2026-09-01T08:00:00Z", periods=2, freq="60s"),
        }
    )
    concentration = pd.DataFrame(
        [
            {"session_id": "s", "level": 1, "recorded_at": "2026-09-01T08:00:10Z"},
            {"session_id": "s", "level": 4, "recorded_at": "2026-09-01T08:01:10Z"},
        ]
    )
    out = attach_focus_reference(windows, concentration, method="session")
    assert out["focus_reference"].tolist() == [4, 4]


def test_build_window_features_columns(prepared):
    features = prepared["features"]
    for column in ("typing_rate", "mouse_distance", "idle_ratio", "interaction_state"):
        assert column in features.columns
    assert features["window_size_seconds"].iloc[0] == 60
    assert features["application_sequence"].notna().all()
    assert np.isfinite(features["typing_rate"]).all()
