"""Behavioural output contract for FocusTrack multimodal integration.

Component 1 hands the behavioural-intelligence layer to the rest of FocusTrack
(proposal sections 4.2 and 4.3). This module defines and validates the two
outputs the component exposes:

* a **window-level stream** -- the interaction state (and transition) per
  temporal window, for temporal fusion;
* a **session-level summary** -- dominant state, state composition, transition,
  interruption and recovery measures, plus the concentration-related prediction
  and a plain-language summary (UR5).

The schema is versioned so downstream components can rely on stable field names.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from src.config import RESULTS_DIR

INTEGRATION_SCHEMA_VERSION = "1.0"

WINDOW_OUTPUT_SCHEMA = (
    "participant_id",
    "session_id",
    "context",
    "context_code",
    "window_index",
    "window_start",
    "interaction_state",
    "transition_type",
    "state_duration",
)

SESSION_OUTPUT_SCHEMA = (
    "participant_id",
    "session_id",
    "context",
    "context_code",
    "session_duration_seconds",
    "n_windows",
    "dominant_state",
    "mean_state_duration",
    "state_change_rate",
    "state_entropy",
    "interruption_count",
    "recovery_count",
    "predicted_label",
    "predicted_probability",
    "behavioural_summary",
)


def build_window_output(features: pd.DataFrame) -> pd.DataFrame:
    """Window-level behavioural stream exposed to other components."""
    columns = [c for c in WINDOW_OUTPUT_SCHEMA if c in features.columns]
    out = features.loc[:, columns].copy() if columns else pd.DataFrame()
    if "window_start" in out.columns:
        out["window_start"] = pd.to_datetime(out["window_start"], utc=True, errors="coerce")
    return out


def _state_share_columns(dataset: pd.DataFrame) -> dict[str, str]:
    rename = {}
    for column in dataset.columns:
        if column.startswith("state__share_"):
            rename[column] = "state_share_" + column.rsplit("_", 1)[-1]
    return rename


def _first_column(frame: pd.DataFrame, *candidates: str):
    """First matching column — dataset builders prefix some fields (``base__``)."""
    for candidate in candidates:
        if candidate in frame.columns:
            return frame[candidate]
    return None


def build_session_output(
    dataset: pd.DataFrame,
    predictions: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Session-level behavioural summary, optionally with model predictions."""
    if dataset.empty:
        return pd.DataFrame(columns=SESSION_OUTPUT_SCHEMA)

    frame = dataset.copy()
    rename = _state_share_columns(frame)
    out = pd.DataFrame(
        {
            "participant_id": frame.get("participant_id"),
            "session_id": frame.get("session_id"),
            "context": frame.get("context"),
            "context_code": _first_column(frame, "context_code", "ctx__code"),
            "session_duration_seconds": _first_column(
                frame, "base__session_duration_seconds", "session_duration_seconds"
            ),
            "n_windows": frame.get("n_windows"),
            "dominant_state": frame.get("state__dominant"),
            "mean_state_duration": frame.get("trans__state_duration_mean"),
            "state_change_rate": frame.get("trans__state_change_rate_mean"),
            "state_entropy": frame.get("trans__state_entropy_mean"),
            "interruption_count": frame.get("trans__interruption_count_mean"),
            "recovery_count": frame.get("trans__recovery_count_mean"),
        }
    )
    for source, target in rename.items():
        out[target] = frame[source]

    if predictions is not None and not predictions.empty:
        keys = ["participant_id", "session_id"]
        merge_cols = keys + [c for c in ("y_pred", "y_proba", "predicted_label", "predicted_probability") if c in predictions.columns]
        merged = out.merge(predictions[merge_cols], on=keys, how="left", suffixes=("", "_pred"))
        if "y_pred" in merged.columns:
            merged["predicted_label"] = merged["y_pred"]
        if "y_proba" in merged.columns:
            merged["predicted_probability"] = merged["y_proba"]
        out = merged.drop(columns=[c for c in ("y_pred", "y_proba") if c in merged.columns])

    if "predicted_label" not in out.columns:
        out["predicted_label"] = pd.NA
    if "predicted_probability" not in out.columns:
        out["predicted_probability"] = np.nan

    out["behavioural_summary"] = out.apply(session_behavioural_summary, axis=1)

    # Keep the declared schema columns first so downstream consumers get a
    # stable prefix; state-composition columns follow afterwards.
    ordered = [column for column in SESSION_OUTPUT_SCHEMA if column in out.columns]
    extras = [column for column in out.columns if column not in ordered]
    return out[ordered + extras].reset_index(drop=True)


def session_behavioural_summary(row: pd.Series) -> str:
    """Plain-language description of a session's behavioural structure (UR5)."""
    context = row.get("context") or "study"
    dominant = row.get("dominant_state")
    duration = row.get("session_duration_seconds")
    interruptions = row.get("interruption_count")
    recoveries = row.get("recovery_count")
    mean_run = row.get("mean_state_duration")

    parts = [f"{str(context).capitalize()} session"]
    if isinstance(dominant, (int, float)) and not pd.isna(dominant):
        parts.append(f"predominantly interaction state {int(dominant)}")
    if isinstance(duration, (int, float)) and not pd.isna(duration):
        parts.append(f"lasting {duration / 60:.1f} min")
    sentence = ", ".join(parts) + "."
    detail = []
    if isinstance(interruptions, (int, float)) and not pd.isna(interruptions):
        detail.append(f"{int(round(interruptions))} interruptions")
    if isinstance(recoveries, (int, float)) and not pd.isna(recoveries):
        detail.append(f"{int(round(recoveries))} recoveries")
    if isinstance(mean_run, (int, float)) and not pd.isna(mean_run):
        detail.append(f"average run of {mean_run:.1f} windows")
    if detail:
        sentence += " Observed " + ", ".join(detail) + "."
    prediction = row.get("predicted_label")
    if prediction is not None and not pd.isna(prediction):
        sentence += f" Concentration-related prediction: level {int(prediction)}."
    return sentence


def validate_output(frame: pd.DataFrame, schema: tuple[str, ...]) -> list[str]:
    """Return a list of schema violations (empty means valid)."""
    problems: list[str] = []
    missing = [column for column in schema if column not in frame.columns]
    if missing:
        problems.append(f"missing columns: {', '.join(missing)}")
    if "session_id" in frame.columns and frame["session_id"].isna().any():
        problems.append("session_id contains missing values")
    if "interaction_state" in frame.columns and frame["interaction_state"].isna().any():
        problems.append("interaction_state contains missing values")
    return problems


def build_outputs(
    features: pd.DataFrame,
    dataset: pd.DataFrame,
    predictions: pd.DataFrame | None = None,
) -> dict[str, pd.DataFrame]:
    return {
        "behavioural_output_window": build_window_output(features),
        "behavioural_output_session": build_session_output(dataset, predictions),
    }


def save_outputs(
    outputs: dict[str, pd.DataFrame],
    target: Path | None = None,
) -> dict[str, Path]:
    directory = Path(target or (RESULTS_DIR / "integration"))
    directory.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for name, frame in outputs.items():
        path = directory / f"{name}.csv"
        frame.to_csv(path, index=False)
        written[name] = path
    return written
