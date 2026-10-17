"""Session-level dataset construction for concentration classification.

Window-level behavioural features are aggregated to one row per learning
session. Every feature belongs to exactly one representation group so that the
proposed model, the baseline and the ablation experiment can be assembled from
the same table:

``baseline``   conventional aggregated interaction features
``temporal``   temporal-window features beyond simple aggregation
``state``      discovered interaction-state composition
``transition`` state-transition / persistence / interruption measures
``context``    learning-activity context (context + context x state)
"""

import numpy as np
import pandas as pd

from src.config import (
    BASELINE_SESSION_COLS,
    FEATURE_GROUP_ORDER,
    STATE_COL,
    TEMPORAL_SESSION_COLS,
    TRANSITION_SESSION_COLS,
)

ID_COLS = ["participant_id", "session_id"]
GROUP_KEYS = ["participant_id", "session_id"]

LABEL_COL = "concentration_label"
BINARY_LABEL_COL = "concentration_binary"
LABEL_MEAN_COL = "concentration_mean"


def session_concentration_labels(
    concentration: pd.DataFrame,
    agg: str = "mean",
) -> pd.DataFrame:
    """Aggregate a session's self-reported ratings into a session-level label."""
    columns = ["session_id", LABEL_COL, BINARY_LABEL_COL, LABEL_MEAN_COL, "n_ratings"]
    if concentration is None or concentration.empty or "level" not in concentration.columns:
        return pd.DataFrame(columns=columns)

    frame = concentration.copy()
    frame["level"] = pd.to_numeric(frame["level"], errors="coerce")
    frame = frame.dropna(subset=["session_id", "level"])
    if frame.empty:
        return pd.DataFrame(columns=columns)

    grouped = frame.groupby("session_id")["level"]
    summary = pd.DataFrame(
        {
            LABEL_MEAN_COL: grouped.mean(),
            "n_ratings": grouped.size(),
        }
    )
    if agg == "median":
        summary[LABEL_MEAN_COL] = grouped.median()
    # Round half up so that e.g. 4.5 -> 5, then clip to the 1-5 scale.
    summary[LABEL_COL] = (summary[LABEL_MEAN_COL] + 0.5).apply(np.floor).clip(1, 5).astype(int)
    summary[BINARY_LABEL_COL] = (summary[LABEL_MEAN_COL] >= 3.5).astype(int)
    return summary.reset_index()


def _aggregate_numeric(
    features: pd.DataFrame,
    agg: pd.core.groupby.DataFrameGroupBy,
    columns: list[str],
    prefix: str,
) -> tuple[pd.DataFrame, list[str]]:
    present = [c for c in columns if c in features.columns]
    if not present:
        return pd.DataFrame(index=agg.size().index), []
    grouped = features.groupby(GROUP_KEYS, dropna=False)
    produced: dict[str, pd.Series] = {}
    for col in present:
        produced[f"{prefix}__{col}_mean"] = grouped[col].mean()
        produced[f"{prefix}__{col}_std"] = grouped[col].std(ddof=0).fillna(0.0)
    frame = pd.DataFrame(produced)
    return frame, list(frame.columns)


def _state_features(features: pd.DataFrame, n_states: int) -> tuple[pd.DataFrame, list[str]]:
    if STATE_COL not in features.columns:
        return pd.DataFrame(index=features.groupby(GROUP_KEYS, dropna=False).size().index), []
    grouped = features.groupby(GROUP_KEYS, dropna=False)
    total = grouped.size()
    produced: dict[str, pd.Series] = {}
    for state in range(n_states):
        share = features.assign(_hit=(pd.to_numeric(features[STATE_COL], errors="coerce") == state).astype(int))
        produced[f"state__share_{state}"] = share.groupby(GROUP_KEYS, dropna=False)["_hit"].mean()
        produced[f"state__share_{state}"] = produced[f"state__share_{state}"].reindex(total.index).fillna(0.0)
    dominant = grouped[STATE_COL].agg(lambda s: int(pd.to_numeric(s, errors="coerce").mode().iloc[0]) if not pd.to_numeric(s, errors="coerce").mode().empty else -1)
    produced["state__dominant"] = dominant
    frame = pd.DataFrame(produced)
    return frame, list(frame.columns)


def _transition_features(features: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    grouped = features.groupby(GROUP_KEYS, dropna=False)
    index = grouped.size().index
    produced: dict[str, pd.Series] = {}
    for col in TRANSITION_SESSION_COLS:
        if col not in features.columns:
            continue
        produced[f"trans__{col}_mean"] = grouped[col].mean()
        produced[f"trans__{col}_max"] = grouped[col].max()
    if "is_transition" in features.columns:
        transitions = grouped["is_transition"].sum()
        produced["trans__self_transition_rate"] = 1.0 - (transitions / grouped.size())
    frame = pd.DataFrame(produced)
    return frame, list(frame.columns)


def _context_features(features: pd.DataFrame, n_states: int) -> tuple[pd.DataFrame, list[str]]:
    index = features.groupby(GROUP_KEYS, dropna=False).size().index
    produced: dict[str, pd.Series] = {}
    if "context_code" in features.columns:
        produced["ctx__code"] = features.groupby(GROUP_KEYS, dropna=False)["context_code"].first()
    if "context_code" in features.columns and STATE_COL in features.columns:
        dominant = features.groupby(GROUP_KEYS, dropna=False)[STATE_COL].agg(
            lambda s: int(pd.to_numeric(s, errors="coerce").mode().iloc[0]) if not pd.to_numeric(s, errors="coerce").mode().empty else -1
        )
        code = features.groupby(GROUP_KEYS, dropna=False)["context_code"].first()
        produced["ctx__state_id"] = code.astype("float") * max(n_states, 1) + dominant
    frame = pd.DataFrame(produced).reindex(index) if produced else pd.DataFrame(index=index)
    return frame, list(frame.columns)


def build_session_dataset(
    features: pd.DataFrame,
    concentration: pd.DataFrame | None = None,
    require_label: bool = True,
) -> tuple[pd.DataFrame, dict[str, list[str]]]:
    """Return ``(dataset, feature_groups)`` at one row per learning session."""
    empty_groups: dict[str, list[str]] = {name: [] for name in FEATURE_GROUP_ORDER}
    if features.empty:
        return pd.DataFrame(), empty_groups

    n_states = int(pd.to_numeric(features[STATE_COL], errors="coerce").max()) + 1 if STATE_COL in features.columns else 0
    grouped = features.groupby(GROUP_KEYS, dropna=False)
    parts: list[pd.DataFrame] = []

    baseline, baseline_cols = _aggregate_numeric(features, grouped, BASELINE_SESSION_COLS, "base")
    temporal, temporal_cols = _aggregate_numeric(features, grouped, TEMPORAL_SESSION_COLS, "temp")
    states, state_cols = _state_features(features, n_states)
    transitions, transition_cols = _transition_features(features)
    context, context_cols = _context_features(features, n_states)

    # session metadata
    meta = grouped.agg(
        context=("context", "first") if "context" in features.columns else (STATE_COL, "first"),
        n_windows=("window_index", "size") if "window_index" in features.columns else (STATE_COL, "size"),
    )
    if {"window_start", "window_end"}.issubset(features.columns):
        bounds = grouped.agg(start=("window_start", "min"), end=("window_end", "max"))
        meta["session_duration_seconds"] = (bounds["end"] - bounds["start"]).dt.total_seconds()

    parts.extend([baseline, temporal, states, transitions, context])
    dataset = pd.concat([meta] + parts, axis=1).reset_index()

    baseline_cols = list(baseline_cols)
    if "session_duration_seconds" in dataset.columns:
        baseline_cols.append("base__session_duration_seconds")

    # labels
    if concentration is not None:
        labels = session_concentration_labels(concentration)
        dataset = dataset.merge(labels, on="session_id", how="left")
    elif "focus_reference" in features.columns:
        mean_reference = grouped["focus_reference"].mean()
        dataset = dataset.merge(
            pd.DataFrame({LABEL_MEAN_COL: mean_reference, "n_ratings": grouped["focus_reference"].count()}).reset_index(),
            on=GROUP_KEYS,
            how="left",
        )
        dataset[LABEL_COL] = dataset[LABEL_MEAN_COL].round().clip(1, 5)
        dataset[BINARY_LABEL_COL] = (dataset[LABEL_MEAN_COL] >= 3.5).astype("Int64")

    if require_label and LABEL_COL in dataset.columns:
        dataset = dataset.dropna(subset=[LABEL_MEAN_COL]).reset_index(drop=True)
        dataset[LABEL_COL] = dataset[LABEL_COL].astype(int)
        dataset[BINARY_LABEL_COL] = dataset[BINARY_LABEL_COL].astype(int)

    feature_groups = {
        "baseline": sorted(set(baseline_cols)),
        "temporal": sorted(set(temporal_cols)),
        "state": sorted(set(state_cols)),
        "transition": sorted(set(transition_cols)),
        "context": sorted(set(context_cols)),
    }
    return dataset.reset_index(drop=True), feature_groups


def select_features(groups: dict[str, list[str]], include: list[str]) -> list[str]:
    """Flatten selected representation groups into an ordered column list."""
    columns: list[str] = []
    for name in FEATURE_GROUP_ORDER:
        if name in include:
            columns.extend(groups.get(name, []))
    return columns
