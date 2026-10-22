"""Transition features from a decoded state sequence (proposal SO4).

Definitions (per epoch, within a session):

* ``state_dwell`` – length of the current run of the same state;
* ``state_changes_5min`` – state changes in the last five epochs;
* ``time_since_interruption`` – epochs since the last interruption-like state,
  capped at five and flagged when censored;
* ``recovery_epochs`` – consecutive non-interruption epochs since the last
  interruption (0 while still in one, ``NaN`` if none has occurred yet);
* ``recovered`` – recovery run of at least ``recovery_epochs``.

An optional boolean column overrides the state membership (used to treat idle
as normal in non-screen sessions and only count computer use as an
interruption).
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def attach_transition_features(
    sequence: pd.DataFrame,
    interruption_states: list[int] | set[int] | None = None,
    recovery_epochs: int = 3,
    window: int = 5,
    interruption_mask: str | None = None,
) -> pd.DataFrame:
    required = {"session_id", "epoch_index", "state"}
    missing = required - set(sequence.columns)
    if missing:
        raise ValueError(f"state sequence is missing columns: {', '.join(sorted(missing))}")
    if interruption_mask is not None and interruption_mask not in sequence.columns:
        raise ValueError(f"interruption mask column {interruption_mask!r} is missing")

    interruption = {int(s) for s in (interruption_states or [])}
    out = (
        sequence.sort_values(["session_id", "epoch_index"], kind="mergesort")
        .reset_index(drop=True)
        .copy()
    )
    mask = (
        out[interruption_mask].astype(bool).to_numpy()
        if interruption_mask is not None
        else out["state"].isin(interruption).to_numpy()
    )
    columns = {
        "is_interruption": np.zeros(len(out), dtype=int),
        "state_dwell": np.zeros(len(out), dtype=int),
        "state_changes_5min": np.zeros(len(out), dtype=int),
        "time_since_interruption": np.full(len(out), np.nan),
        "interruption_censored": np.zeros(len(out), dtype=int),
        "recovery_epochs": np.full(len(out), np.nan),
        "recovered": np.zeros(len(out), dtype=int),
    }

    for _, idx in out.groupby("session_id", sort=False).indices.items():
        states = out.loc[idx, "state"].to_numpy(dtype=int)
        dwell = 1
        last_interruption: int | None = None
        for i, state in enumerate(states):
            if i > 0 and state == states[i - 1]:
                dwell += 1
            else:
                dwell = 1

            start = max(0, i - window + 1)
            run = states[start : i + 1]
            changes = int(np.sum(run[1:] != run[:-1]))

            is_int = bool(mask[idx[i]])
            if is_int:
                last_interruption = i
                since = 0
                censored = 0
                recovery = 0.0
                recovered = 0
            else:
                if last_interruption is None:
                    since = float(window)
                    censored = 1
                    recovery = np.nan
                    recovered = 0
                else:
                    gap = i - last_interruption
                    since = float(min(gap, window))
                    censored = int(gap > window)
                    recovery = float(gap)
                    recovered = int(gap >= recovery_epochs)

            columns["is_interruption"][idx[i]] = int(is_int)
            columns["state_dwell"][idx[i]] = dwell
            columns["state_changes_5min"][idx[i]] = changes
            columns["time_since_interruption"][idx[i]] = since
            columns["interruption_censored"][idx[i]] = censored
            columns["recovery_epochs"][idx[i]] = recovery
            columns["recovered"][idx[i]] = recovered

    for name, values in columns.items():
        out[name] = values
    return out.reset_index(drop=True)
