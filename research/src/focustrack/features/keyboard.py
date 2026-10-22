"""Keyboard features from event-level timing metadata (proposal 3.4.3, SO2).

Only the *time* of a key press and a Backspace/Delete flag are used. Key
characters are never part of the event schema.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from focustrack.config import Config

KEY_KINDS = ("key", "back")


def _keys_in(events: pd.DataFrame, start: float, end: float) -> pd.DataFrame:
    mask = events["kind"].isin(KEY_KINDS) & (events["t"] >= start) & (events["t"] < end)
    return events.loc[mask]


def _bursts(times: np.ndarray, gap_seconds: float) -> list[np.ndarray]:
    """Split sorted key times into bursts separated by more than ``gap_seconds``."""
    if times.size == 0:
        return []
    splits = np.where(np.diff(times) > gap_seconds)[0] + 1
    return np.split(times, splits)


def keyboard_features(
    events: pd.DataFrame,
    start: float,
    end: float,
    cfg: Config,
) -> dict[str, float]:
    """Compute keyboard features for one epoch ``[start, end)``.

    Missing values are ``NaN`` (not zero) when the feature is undefined – for
    example, inter-key timing when fewer than two keys were pressed. This keeps
    missingness visible for imputation inside each validation fold.
    """
    duration = max(end - start, 1e-9)
    minutes = duration / 60.0
    keys = _keys_in(events, start, end)
    times = np.sort(keys["t"].to_numpy(dtype=float))
    n_keys = int(times.size)

    out: dict[str, float] = {
        "key_count": float(n_keys),
        "typing_rate": n_keys / minutes,
        "inter_key_mean_ms": np.nan,
        "inter_key_cv": np.nan,
        "backspace_ratio": np.nan,
        "burst_count": 0.0,
        "mean_burst_duration_s": np.nan,
        "mean_burst_length": np.nan,
    }
    if n_keys == 0:
        return out

    backs = int((keys["kind"] == "back").sum())
    out["backspace_ratio"] = backs / n_keys

    if n_keys >= 2:
        intervals = np.diff(times)
        mean_s = float(intervals.mean())
        out["inter_key_mean_ms"] = mean_s * 1000.0
        if mean_s > 0:
            out["inter_key_cv"] = float(intervals.std(ddof=0) / mean_s)

    bursts = _bursts(times, cfg.burst_gap_seconds)
    out["burst_count"] = len(bursts) / minutes
    out["mean_burst_length"] = float(np.mean([len(b) for b in bursts]))
    out["mean_burst_duration_s"] = float(
        np.mean([b[-1] - b[0] for b in bursts])
    )
    return out
