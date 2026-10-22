import numpy as np
import pandas as pd

from focustrack.features.build import build_from_events, canonicalise_epochs


def test_canonicalise_renames_and_flags(cfg):
    raw = pd.DataFrame(
        {
            "session_id": ["s1", "s1"],
            "participant_id": ["p1", "p1"],
            "epoch_index": [0, 1],
            "study_mode": ["screen", "screen"],
            "task": ["coding", "coding"],
            "typing_rate": [60.0, 0.0],
            "inter_key_var": [0.3, 0.5],
            "backspace_ratio": [0.1, 0.1],
            "idle_ratio": [0.2, 0.9],
            "mouse_speed": [120.0, 0.0],
            "switch_rate": [1.0, 0.0],
        }
    )
    out = canonicalise_epochs(raw, cfg)

    assert "inter_key_cv" in out.columns
    assert "inter_key_var" not in out.columns
    assert out["mouse_path_px"].iloc[0] == 120.0 * 60
    assert out["keyboard_active"].tolist() == [True, False]
    assert out["is_missing_inter_key_mean_ms"].tolist() == [1, 1]
    assert out["is_missing_click_rate"].tolist() == [1, 1]


def test_build_from_events_produces_one_row_per_epoch(cfg):
    sessions = pd.DataFrame(
        {
            "session_id": ["s1"],
            "participant_id": ["p1"],
            "study_mode": ["screen"],
            "task": ["coding"],
            "duration_seconds": [120],
        }
    )
    events = pd.DataFrame(
        {
            "session_id": ["s1"] * 8,
            "t": [0, 1, 2, 3, 4, 5, 30, 40],
            "kind": ["key"] * 6 + ["move", "switch"],
            "dist": [np.nan] * 6 + [10.0, np.nan],
            "app": [None] * 7 + ["Visual Studio Code"],
        }
    )
    out = build_from_events(events, sessions, cfg)

    assert len(out) == 2
    assert out["typing_rate"].iloc[0] == 6.0  # six keys in the first minute
    assert out["switch_rate"].iloc[0] == 1.0
    assert out["mouse_path_px"].iloc[0] == 10.0
    assert out["epoch_index"].tolist() == [0, 1]
