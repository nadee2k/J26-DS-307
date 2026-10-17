"""State-transition modelling (proposal section 3.6, SO4).

Quantifies how learners move between the discovered interaction states:
state duration, persistence, change rate, entropy, interruptions and recovery.

The discovered states are data-driven and are deliberately *not* given
concentration names, so interruption / recovery are defined structurally:

* ``interruption_count``  -- number of state changes so far in the session.
* ``recovery_count``      -- number of times the learner returns to the state
  that was active two steps earlier (an ``A -> B -> A`` pattern).
"""

import numpy as np
import pandas as pd

from src.config import STATE_COL

GROUP_COLS = ("participant_id", "session_id")
ORDER_COL = "window_index"

TRANSITION_OUTPUT_COLS = (
    "previous_state",
    "transition_type",
    "is_transition",
    "state_duration",
    "stable_state_duration",
    "state_change_rate",
    "state_entropy",
    "interruption_count",
    "recovery_count",
)


def _entropy(values: list) -> float:
    if not values:
        return 0.0
    series = pd.Series(values, dtype="object")
    counts = series.value_counts(normalize=True).to_numpy(dtype=float)
    counts = counts[counts > 0]
    if counts.size == 0:
        return 0.0
    return float(-(counts * np.log(counts)).sum())


def _format_state(value) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)) or pd.isna(value):
        return "na"
    return str(int(value)) if float(value).is_integer() else str(value)


def _empty(features: pd.DataFrame) -> pd.DataFrame:
    out = features.copy()
    for col in TRANSITION_OUTPUT_COLS:
        if col not in out.columns:
            out[col] = pd.NA
    return out


def add_state_transitions(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
    order_col: str = ORDER_COL,
) -> pd.DataFrame:
    """Add per-window transition features for every participant session."""
    if features.empty or state_col not in features.columns:
        return _empty(features)

    out = features.copy()
    group_cols = [c for c in GROUP_COLS if c in out.columns]
    if not group_cols:
        out["_session_key"] = 0
        group_cols = ["_session_key"]

    frames = []
    for _, group in out.groupby(group_cols, dropna=False, sort=False):
        g = group.sort_values(order_col).copy() if order_col in group.columns else group.copy()
        states = pd.to_numeric(g[state_col], errors="coerce").to_numpy(dtype=float)

        n = len(states)
        previous = np.full(n, np.nan, dtype=float)
        previous[1:] = states[:-1]
        transition_type = ["start"] * n
        is_transition = np.zeros(n, dtype=bool)
        state_duration = np.zeros(n, dtype=int)
        stable_state_duration = np.zeros(n, dtype=int)
        state_change_rate = np.zeros(n, dtype=float)
        state_entropy = np.zeros(n, dtype=float)
        interruption_count = np.zeros(n, dtype=int)
        recovery_count = np.zeros(n, dtype=int)

        seen: list = []
        completed_runs: list[int] = []
        current = object()
        run_length = 0
        changes = 0
        recoveries = 0

        for index, state in enumerate(states):
            if index == 0 or not _same(state, current):
                if index > 0:
                    changes += 1
                    completed_runs.append(run_length)
                    is_transition[index] = True
                    transition_type[index] = f"{_format_state(previous[index])}->{_format_state(state)}"
                current = state
                run_length = 1
            else:
                run_length += 1

            state_duration[index] = run_length
            longest = max(completed_runs) if completed_runs else run_length
            stable_state_duration[index] = max(longest, run_length)

            seen.append(state)
            state_entropy[index] = _entropy(seen)
            state_change_rate[index] = changes / (index + 1)
            interruption_count[index] = changes

            if (
                index >= 2
                and not pd.isna(states[index])
                and not pd.isna(states[index - 1])
                and not pd.isna(states[index - 2])
                and _same(states[index], states[index - 2])
                and not _same(states[index], states[index - 1])
            ):
                recoveries += 1
            recovery_count[index] = recoveries

        g["previous_state"] = previous
        g["transition_type"] = transition_type
        g["is_transition"] = is_transition
        g["state_duration"] = state_duration
        g["stable_state_duration"] = stable_state_duration
        g["state_change_rate"] = state_change_rate
        g["state_entropy"] = state_entropy
        g["interruption_count"] = interruption_count
        g["recovery_count"] = recovery_count
        frames.append(g)

    result = pd.concat(frames, ignore_index=True)
    return result.drop(columns=["_session_key"], errors="ignore")


def _same(a, b) -> bool:
    if pd.isna(a) and pd.isna(b):
        return True
    return bool(a == b)


def state_runs(features: pd.DataFrame, state_col: str = STATE_COL) -> pd.DataFrame:
    """Run-length view: consecutive stretches of the same interaction state."""
    if features.empty or state_col not in features.columns:
        return pd.DataFrame()

    ordered = features.sort_values(
        [c for c in (*GROUP_COLS, ORDER_COL) if c in features.columns]
    )
    rows = []
    for keys, group in ordered.groupby([c for c in GROUP_COLS if c in ordered.columns], dropna=False, sort=False):
        key_map = dict(zip([c for c in GROUP_COLS if c in ordered.columns], keys if isinstance(keys, tuple) else (keys,)))
        run_id = 0
        previous = object()
        length = 0
        run_start = None
        for _, row in group.iterrows():
            state = row[state_col]
            if run_start is None or not _same(state, previous):
                if run_start is not None:
                    rows.append(
                        {
                            **key_map,
                            "run_id": run_id,
                            "state": previous,
                            "window_start": run_start,
                            "length_windows": length,
                        }
                    )
                    run_id += 1
                run_start = row.get("window_start")
                previous = state
                length = 1
            else:
                length += 1
        if run_start is not None:
            rows.append({**key_map, "run_id": run_id, "state": previous, "window_start": run_start, "length_windows": length})
    return pd.DataFrame(rows)


def transition_counts(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
    by: str | None = None,
) -> pd.DataFrame:
    """Counts of observed state-to-state transitions (optionally grouped)."""
    out_columns = ([by] if by else []) + ["from_state", "to_state", "count"]
    if features.empty or state_col not in features.columns:
        return pd.DataFrame(columns=out_columns)
    ordered = features.sort_values([c for c in (*GROUP_COLS, ORDER_COL) if c in features.columns])
    session_cols = [c for c in GROUP_COLS if c in ordered.columns]
    extra = [by] if by and by in ordered.columns else []
    source = ordered[session_cols + extra + [state_col]].copy()
    source["from_state"] = source.groupby(session_cols, dropna=False)[state_col].shift(1)
    source["to_state"] = source[state_col]
    source = source.dropna(subset=["from_state", "to_state"])
    if source.empty:
        return pd.DataFrame(columns=out_columns)
    source["from_state"] = source["from_state"].astype(int)
    source["to_state"] = source["to_state"].astype(int)
    group_columns = ([by] if by else []) + ["from_state", "to_state"]
    return source.groupby(group_columns, dropna=False).size().reset_index(name="count")


def transition_probabilities(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
    by: str | None = None,
) -> pd.DataFrame:
    """Row-normalised transition probabilities (P(next state | current state))."""
    counts = transition_counts(features, state_col=state_col, by=by)
    if counts.empty:
        return counts.assign(probability=pd.Series(dtype=float))
    group_cols = ([by] if by else []) + ["from_state"]
    totals = counts.groupby(group_cols)["count"].transform("sum")
    counts["probability"] = counts["count"] / totals
    return counts


def session_transition_summary(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
) -> pd.DataFrame:
    """One row per session summarising its state-transition structure."""
    if features.empty or state_col not in features.columns:
        return pd.DataFrame()

    group_cols = [c for c in (*GROUP_COLS, "context") if c in features.columns]
    rows = []
    for keys, group in features.groupby(group_cols, dropna=False, sort=False):
        key_map = dict(zip(group_cols, keys if isinstance(keys, tuple) else (keys,)))
        ordered = group.sort_values(ORDER_COL) if ORDER_COL in group.columns else group
        states = pd.to_numeric(ordered[state_col], errors="coerce").dropna().to_numpy(dtype=int)
        if states.size == 0:
            continue
        changes = int((states[1:] != states[:-1]).sum()) if states.size > 1 else 0
        runs = _run_lengths(states)
        dominant = pd.Series(states).value_counts().idxmax()
        rows.append(
            {
                **key_map,
                "n_windows": int(states.size),
                "n_states_observed": int(pd.unique(states).size),
                "n_transitions": changes,
                "n_runs": int(len(runs)),
                "mean_run_length": float(np.mean(runs)) if runs else 0.0,
                "max_run_length": int(np.max(runs)) if runs else 0,
                "dominant_state": int(dominant),
                "state_entropy": _entropy(list(states)),
                "interruption_count": changes,
                "recovery_count": _recovery_count(states),
            }
        )
    return pd.DataFrame(rows)


def _run_lengths(states: np.ndarray) -> list[int]:
    if states.size == 0:
        return []
    lengths = []
    current = states[0]
    length = 1
    for value in states[1:]:
        if value == current:
            length += 1
        else:
            lengths.append(length)
            current = value
            length = 1
    lengths.append(length)
    return lengths


def _recovery_count(states: np.ndarray) -> int:
    if states.size < 3:
        return 0
    count = 0
    for i in range(2, states.size):
        if states[i] == states[i - 2] and states[i] != states[i - 1]:
            count += 1
    return count
