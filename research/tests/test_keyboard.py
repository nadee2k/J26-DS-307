import numpy as np
import pandas as pd

from focustrack.features.keyboard import keyboard_features


def events(times, kinds=None):
    n = len(times)
    return pd.DataFrame(
        {
            "session_id": ["s1"] * n,
            "t": times,
            "kind": kinds or ["key"] * n,
            "dist": np.nan,
            "app": None,
        }
    )


def test_steady_typing_is_one_burst(cfg):
    ev = events(list(range(10)))
    f = keyboard_features(ev, 0, 60, cfg)

    assert f["typing_rate"] == 10.0
    assert f["inter_key_mean_ms"] == 1000.0
    assert f["inter_key_cv"] == 0.0
    assert f["backspace_ratio"] == 0.0
    assert f["burst_count"] == 1.0
    assert f["mean_burst_length"] == 10.0
    assert f["mean_burst_duration_s"] == 9.0


def test_gap_splits_bursts(cfg):
    ev = events([0, 1, 2, 10, 11, 12])
    f = keyboard_features(ev, 0, 60, cfg)

    assert f["burst_count"] == 2.0
    assert f["mean_burst_length"] == 3.0
    assert f["mean_burst_duration_s"] == 2.0


def test_backspace_ratio(cfg):
    ev = events([0, 1, 2, 3], kinds=["key", "key", "back", "back"])
    f = keyboard_features(ev, 0, 60, cfg)

    assert f["backspace_ratio"] == 0.5


def test_no_keys_keeps_missingness_visible(cfg):
    ev = events([], kinds=[])
    f = keyboard_features(ev, 0, 60, cfg)

    assert f["typing_rate"] == 0.0
    assert f["burst_count"] == 0.0
    assert np.isnan(f["inter_key_mean_ms"])
    assert np.isnan(f["inter_key_cv"])
    assert np.isnan(f["backspace_ratio"])


def test_epoch_boundary_is_half_open(cfg):
    ev = events([0, 60])
    f = keyboard_features(ev, 0, 60, cfg)

    assert f["typing_rate"] == 1.0
