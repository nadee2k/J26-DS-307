"""Interpret discovered states and describe their transitions."""

from __future__ import annotations

import numpy as np
import pandas as pd

LABELS = (
    "Sustained typing",
    "Frequent switching",
    "Idle / away",
    "Browsing / light activity",
)
INTERRUPTION_LABELS = {"Frequent switching", "Idle / away"}


def _zscore(series: pd.Series) -> pd.Series:
    sd = series.std(ddof=0)
    return (series - series.mean()) / sd if sd and np.isfinite(sd) else series * 0.0


def label_states(profiles: pd.DataFrame) -> list[str]:
    """Give each state a plain-language label from its feature profile.

    The four most interpretable roles are assigned greedily: highest typing,
    then highest switching, then highest idle, then highest mouse activity.
    Extra states are labelled ``Varied activity N``.
    """
    n_states = len(profiles)
    labels: list[str | None] = [None] * n_states
    z = pd.DataFrame(
        {
            column: _zscore(profiles[column])
            for column in ("typing_rate", "switch_rate", "idle_ratio", "mouse_speed_px_s")
            if column in profiles.columns
        }
    ).set_index(profiles["state"].to_numpy())

    def take(column: str, name: str) -> None:
        remaining = [s for s in z.index if labels[int(s)] is None]
        if not remaining or column not in z.columns:
            return
        best = max(remaining, key=lambda s: (z.loc[s, column], -int(s)))
        labels[int(best)] = name

    take("typing_rate", "Sustained typing")
    take("switch_rate", "Frequent switching")
    take("idle_ratio", "Idle / away")
    take("mouse_speed_px_s", "Browsing / light activity")

    extra = 1
    for state, label in enumerate(labels):
        if label is None:
            labels[state] = f"Varied activity {extra}"
            extra += 1
    return [str(label) for label in labels]


def interruption_states(labels: list[str]) -> list[int]:
    """States that mean the learner has left productive work."""
    return [i for i, label in enumerate(labels) if label in INTERRUPTION_LABELS]


def transition_matrix(
    states: np.ndarray,
    lengths: np.ndarray,
    n_states: int,
    labels: list[str] | None = None,
) -> pd.DataFrame:
    """Row-normalised transition probabilities, counted within sessions only."""
    counts = np.zeros((n_states, n_states), dtype=float)
    offset = 0
    for length in lengths:
        sequence = states[offset : offset + length]
        for a, b in zip(sequence[:-1], sequence[1:]):
            counts[int(a), int(b)] += 1
        offset += int(length)

    totals = counts.sum(axis=1, keepdims=True)
    with np.errstate(invalid="ignore", divide="ignore"):
        probs = np.where(totals > 0, counts / totals, np.nan)

    index = [f"{i} · {labels[i]}" if labels else f"from_{i}" for i in range(n_states)]
    columns = [f"{i} · {labels[i]}" if labels else f"to_{i}" for i in range(n_states)]
    return pd.DataFrame(probs, index=index, columns=columns)


def state_sequence(
    meta: pd.DataFrame,
    states: np.ndarray,
    labels: list[str],
) -> pd.DataFrame:
    """Attach the decoded state and its label to the epoch metadata."""
    out = meta[["session_id", "participant_id", "epoch_index"]].copy()
    out["state"] = states.astype(int)
    out["state_label"] = [labels[s] for s in states]
    return out
