"""Mouse features from movement distance and clicks (proposal 3.4.3, SO2)."""

from __future__ import annotations

import pandas as pd

from focustrack.config import Config


def mouse_features(
    events: pd.DataFrame,
    start: float,
    end: float,
    cfg: Config,
) -> dict[str, float]:
    """Mouse path length, mean speed and click rate for one epoch."""
    duration = max(end - start, 1e-9)
    minutes = duration / 60.0
    window = events[(events["t"] >= start) & (events["t"] < end)]

    moves = window[window["kind"] == "move"]
    path = float(moves["dist"].fillna(0).sum()) if not moves.empty else 0.0
    clicks = int((window["kind"] == "click").sum())

    return {
        "mouse_path_px": path,
        "mouse_speed_px_s": path / duration,
        "click_rate": clicks / minutes,
    }
