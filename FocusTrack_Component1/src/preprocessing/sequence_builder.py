"""Behavioural sequence construction (proposal section 3.3, step 6).

Temporal windows are converted into ordered per-session sequences. These are the
inputs for sequential / transition analysis and for any sequential model (for
example an HMM) that may be investigated later.
"""

from pathlib import Path

import pandas as pd

from src.config import SEQUENCES_DIR, STATE_COL

ORDER_COL = "window_index"

STATE_SEQUENCE_COL = "state_sequence"

# Feature columns kept in the long-format window sequence export.
DEFAULT_SEQUENCE_FEATURES = [
    "typing_rate",
    "key_event_count",
    "mouse_distance",
    "mouse_clicks",
    "idle_ratio",
    "mean_mouse_velocity",
    "burst_count",
    "application_switch_frequency",
    "unique_application_count",
]


def _ordered(features: pd.DataFrame) -> pd.DataFrame:
    order = [c for c in ("participant_id", "session_id", ORDER_COL) if c in features.columns]
    if order:
        return features.sort_values(order).reset_index(drop=True)
    return features.reset_index(drop=True)


def build_state_sequences(features: pd.DataFrame, state_col: str = STATE_COL) -> pd.DataFrame:
    """One row per session containing the ordered interaction-state sequence."""
    if features.empty or state_col not in features.columns:
        return pd.DataFrame(columns=["participant_id", "session_id", "context", STATE_SEQUENCE_COL, "sequence_length"])

    ordered = _ordered(features)
    group_cols = [c for c in ("participant_id", "session_id", "context") if c in ordered.columns]
    rows = []
    for keys, group in ordered.groupby(group_cols, dropna=False, sort=False):
        key_map = dict(zip(group_cols, keys if isinstance(keys, tuple) else (keys,)))
        states = [int(s) for s in pd.to_numeric(group[state_col], errors="coerce").dropna().tolist()]
        rows.append(
            {
                "participant_id": key_map.get("participant_id"),
                "session_id": key_map.get("session_id"),
                "context": key_map.get("context"),
                STATE_SEQUENCE_COL: "-".join(str(s) for s in states),
                "sequence_length": len(states),
            }
        )
    return pd.DataFrame(rows)


def build_window_sequences(
    features: pd.DataFrame,
    columns: list[str] | None = None,
    state_col: str = STATE_COL,
) -> pd.DataFrame:
    """Long-format ordered window sequence with a per-session ``step`` index."""
    if features.empty:
        return pd.DataFrame()
    ordered = _ordered(features)
    keep = [c for c in ("participant_id", "session_id", "context") if c in ordered.columns]
    feature_cols = [c for c in (columns or DEFAULT_SEQUENCE_FEATURES) if c in ordered.columns]
    if state_col in ordered.columns and state_col not in feature_cols:
        feature_cols.append(state_col)
    out = ordered.loc[:, keep + feature_cols].copy()
    out["step"] = out.groupby([c for c in ("participant_id", "session_id") if c in out.columns]).cumcount()
    return out.reset_index(drop=True)


def build_sequences(
    features: pd.DataFrame,
    columns: list[str] | None = None,
    state_col: str = STATE_COL,
) -> dict[str, pd.DataFrame]:
    return {
        "state_sequences": build_state_sequences(features, state_col=state_col),
        "window_sequences": build_window_sequences(features, columns=columns, state_col=state_col),
    }


def save_sequences(
    sequences: dict[str, pd.DataFrame],
    target: Path | None = None,
) -> dict[str, Path]:
    directory = Path(target or SEQUENCES_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for name, frame in sequences.items():
        path = directory / f"{name}.csv"
        frame.to_csv(path, index=False)
        written[name] = path
    return written
