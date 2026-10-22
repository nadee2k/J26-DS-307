"""Build the canonical epoch feature table.

Two entry points:

* :func:`build_from_events` – the full proposal 3.4 feature set from raw event
  metadata. This is what real FocusTrack logs use.
* :func:`canonicalise_epochs` – adapt a pre-aggregated epoch table (the PP1
  simulator or ``c1_epochs`` rows) to the same schema. Features that need
  event-level key timing stay ``NaN`` and are flagged, never invented.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from focustrack.config import (
    CANONICAL_COLUMNS,
    MISSING_FLAG_COLUMNS,
    Config,
)
from focustrack.features.app import app_features
from focustrack.features.keyboard import keyboard_features
from focustrack.features.mouse import mouse_features
from focustrack.features.temporal import idle_ratio
from focustrack.prep.clean import clean_events, clean_sessions
from focustrack.prep.windowing import epoch_bounds

RENAMES = {
    "inter_key_var": "inter_key_cv",   # the logger stores the coefficient of variation
    "mouse_speed": "mouse_speed_px_s",
}


def build_from_events(
    events: pd.DataFrame,
    sessions: pd.DataFrame,
    cfg: Config,
) -> pd.DataFrame:
    """Compute one row of features per epoch from raw event metadata."""
    sessions = clean_sessions(sessions)
    events = clean_events(events)
    by_session = {sid: group for sid, group in events.groupby("session_id", sort=False)}

    rows: list[dict] = []
    for session in sessions.itertuples(index=False):
        session_events = by_session.get(session.session_id)
        if session_events is None:
            session_events = events.iloc[0:0]

        for epoch in epoch_bounds(float(session.duration_seconds), cfg.epoch_seconds):
            features: dict[str, float] = {}
            features.update(
                keyboard_features(session_events, epoch.start_s, epoch.end_s, cfg)
            )
            features.update(
                mouse_features(session_events, epoch.start_s, epoch.end_s, cfg)
            )
            features.update(
                app_features(session_events, epoch.start_s, epoch.end_s, session.task, cfg)
            )
            features["idle_ratio"] = idle_ratio(
                session_events, epoch.start_s, epoch.end_s
            )
            if features["key_count"] < cfg.min_keys_for_rhythm:
                features["inter_key_cv"] = np.nan
                features["backspace_ratio"] = np.nan

            rows.append(
                {
                    "session_id": session.session_id,
                    "participant_id": session.participant_id,
                    "epoch_index": epoch.index,
                    "epoch_start_s": epoch.start_s,
                    "epoch_end_s": epoch.end_s,
                    "study_mode": session.study_mode,
                    "task": session.task,
                    **features,
                    "keyboard_active": features["typing_rate"] > 10,
                    "partial_epoch": epoch.partial,
                }
            )

    return _finalise(pd.DataFrame(rows))


def canonicalise_epochs(
    epochs: pd.DataFrame,
    cfg: Config,
    sessions: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Adapt a pre-aggregated epoch table to the canonical schema.

    ``sessions`` supplies ``participant_id`` / ``study_mode`` / ``task`` when the
    epoch export does not carry them. Native columns are kept. Event-only
    features are added as ``NaN`` and marked with ``is_missing_<feature>`` so
    that downstream code can impute them inside each fold instead of treating a
    placeholder as a measurement.
    """
    out = epochs.copy().rename(columns=RENAMES)

    if sessions is not None:
        meta_columns = [
            c
            for c in ("session_id", "participant_id", "study_mode", "task")
            if c in sessions.columns
        ]
        meta = sessions[meta_columns].drop_duplicates("session_id")
        if "participant_id" in out.columns and "participant_id" in meta.columns:
            meta = meta.drop(columns="participant_id")
        drop = [c for c in ("study_mode", "task") if c in out.columns]
        out = out.drop(columns=drop).merge(meta, on="session_id", how="left")

    required = ("session_id", "participant_id", "epoch_index", "study_mode", "task")
    missing = [c for c in required if c not in out.columns]
    if missing:
        raise ValueError(f"epoch table is missing columns: {', '.join(missing)}")

    out["epoch_index"] = out["epoch_index"].astype(int)
    if "epoch_start_s" not in out.columns:
        out["epoch_start_s"] = out["epoch_index"] * cfg.epoch_seconds
    if "epoch_end_s" not in out.columns:
        out["epoch_end_s"] = out["epoch_start_s"] + cfg.epoch_seconds
    duration = (out["epoch_end_s"] - out["epoch_start_s"]).clip(lower=1e-9)

    for column in ("inter_key_cv", "backspace_ratio"):
        if column not in out.columns:
            out[column] = np.nan
    if "key_count" not in out.columns:
        out["key_count"] = out["typing_rate"].fillna(0.0) * duration / 60.0
    quiet = out["key_count"] < cfg.min_keys_for_rhythm
    out.loc[quiet, ["inter_key_cv", "backspace_ratio"]] = np.nan

    if "mouse_path_px" not in out.columns and "mouse_speed_px_s" in out.columns:
        out["mouse_path_px"] = out["mouse_speed_px_s"] * duration

    if "keyboard_active" not in out.columns:
        out["keyboard_active"] = out["typing_rate"].fillna(0.0) > 10
    if "partial_epoch" not in out.columns:
        out["partial_epoch"] = duration < cfg.epoch_seconds

    for column in MISSING_FLAG_COLUMNS:
        if column not in out.columns:
            out[column] = np.nan

    return _finalise(out)


def _finalise(df: pd.DataFrame) -> pd.DataFrame:
    """Ensure the canonical order and add explicit missingness flags."""
    out = df.copy()
    for column in CANONICAL_COLUMNS:
        if column not in out.columns:
            out[column] = np.nan

    extra = [c for c in out.columns if c not in CANONICAL_COLUMNS]
    out = out[list(CANONICAL_COLUMNS) + extra].reset_index(drop=True)

    for column in MISSING_FLAG_COLUMNS:
        out[f"is_missing_{column}"] = out[column].isna().astype(int)
    return out
