"""Temporal features: idle/activity share within an epoch."""

from __future__ import annotations

import math

import pandas as pd

# Leave/return describe visibility, not activity, so they do not make a second active.
NON_ACTIVITY_KINDS = ("leave", "return")


def idle_ratio(events: pd.DataFrame, start: float, end: float) -> float:
    """Share of one-second slots in the epoch with no interaction event."""
    duration = max(end - start, 1e-9)
    window = events[
        (events["t"] >= start)
        & (events["t"] < end)
        & (~events["kind"].isin(NON_ACTIVITY_KINDS))
    ]
    active_seconds = {math.floor(t - start) for t in window["t"].to_numpy(dtype=float)}
    return float(min(1.0, max(0.0, 1.0 - len(active_seconds) / duration)))
