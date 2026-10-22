import numpy as np
import pandas as pd
import pytest

from focustrack.features.app import categorise_app, entropy
from focustrack.features.mouse import mouse_features


def events(rows):
    return pd.DataFrame(rows, columns=["t", "kind", "dist", "app"]).assign(
        session_id="s1"
    )


def test_mouse_path_speed_and_clicks(cfg):
    ev = events(
        [
            [1, "move", 3.0, None],
            [2, "move", 4.0, None],
            [3, "click", np.nan, None],
            [4, "click", np.nan, None],
        ]
    )
    f = mouse_features(ev, 0, 60, cfg)

    assert f["mouse_path_px"] == 7.0
    assert f["mouse_speed_px_s"] == pytest.approx(7 / 60)
    assert f["click_rate"] == 2.0


def test_category_mapping(cfg):
    assert categorise_app("Visual Studio Code", "coding", cfg) == "code_editor"
    assert categorise_app("Acrobat Reader", "reading", cfg) == "document"
    assert categorise_app("Zoom", "zoom", cfg) == "meeting"
    assert categorise_app("Slack", "assignment", cfg) == "messaging"
    assert categorise_app("Google Chrome", "assignment", cfg) == "browser_learning"
    assert categorise_app("Google Chrome", "coding", cfg) == "browser_other"
    assert categorise_app(None, "coding", cfg) == "other"


def test_entropy_is_bits(cfg):
    assert entropy(["a", "a"]) == 0.0
    assert entropy(["a", "b"]) == pytest.approx(1.0)
    assert entropy(["a", "b", "c"]) == pytest.approx(np.log2(3))
    assert np.isnan(entropy([]))


def test_switch_features(cfg):
    ev = events(
        [
            [1, "switch", np.nan, "Visual Studio Code"],
            [2, "switch", np.nan, "Google Chrome"],
            [3, "switch", np.nan, "Slack"],
        ]
    )
    from focustrack.features.app import app_features

    f = app_features(ev, 0, 60, "coding", cfg)
    assert f["switch_rate"] == 3.0
    assert f["unique_apps"] == 3.0
    assert f["app_category_entropy"] == pytest.approx(np.log2(3))
