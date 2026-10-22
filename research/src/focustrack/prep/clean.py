"""Cleaning and validation for raw interaction tables.

Raw events use one row per event::

    session_id, participant_id, t, kind, dist, app

``t`` is seconds since the start of the session. ``kind`` is one of
``key | back | click | move | scroll | leave | return | switch``.
"""

from __future__ import annotations

import pandas as pd

EVENT_KINDS = ("key", "back", "click", "move", "scroll", "leave", "return", "switch")
REQUIRED_EVENT_COLUMNS = ("session_id", "t", "kind")
REQUIRED_SESSION_COLUMNS = ("session_id", "participant_id", "study_mode", "task")


def clean_events(events: pd.DataFrame) -> pd.DataFrame:
    """Validate, normalise and sort an event table.

    Raises ``ValueError`` on missing columns or unknown event kinds so that a
    malformed export fails loudly instead of silently producing features.
    """
    missing = [c for c in REQUIRED_EVENT_COLUMNS if c not in events.columns]
    if missing:
        raise ValueError(f"event table is missing columns: {', '.join(missing)}")

    out = events.copy()
    if "t" not in out.columns and "ts" in out.columns:
        out["t"] = pd.to_datetime(out.pop("ts"))

    # datetime timestamps become seconds relative to each session
    if pd.api.types.is_datetime64_any_dtype(out["t"]):
        out["t"] = (
            out.groupby("session_id")["t"].transform(lambda s: (s - s.min()).dt.total_seconds())
        )

    out["t"] = pd.to_numeric(out["t"], errors="coerce")
    out["kind"] = out["kind"].astype(str).str.lower()
    unknown = sorted(set(out["kind"]) - set(EVENT_KINDS))
    if unknown:
        raise ValueError(f"unknown event kinds: {', '.join(unknown)}")

    out = out.dropna(subset=["t"])
    out = out.drop_duplicates(subset=["session_id", "t", "kind", "app", "dist"])
    return out.sort_values(["session_id", "t"], kind="mergesort").reset_index(drop=True)


def clean_sessions(sessions: pd.DataFrame) -> pd.DataFrame:
    """Validate session metadata and ensure a duration is available."""
    missing = [c for c in REQUIRED_SESSION_COLUMNS if c not in sessions.columns]
    if missing:
        raise ValueError(f"session table is missing columns: {', '.join(missing)}")

    out = sessions.copy()
    if "duration_seconds" not in out.columns:
        if {"started_at", "ended_at"}.issubset(out.columns):
            start = pd.to_datetime(out["started_at"])
            end = pd.to_datetime(out["ended_at"])
            out["duration_seconds"] = (end - start).dt.total_seconds()
        else:
            raise ValueError(
                "session table needs duration_seconds or started_at/ended_at"
            )
    out["duration_seconds"] = pd.to_numeric(out["duration_seconds"], errors="coerce")
    if out["duration_seconds"].isna().any() or (out["duration_seconds"] <= 0).any():
        raise ValueError("every session needs a positive duration_seconds")

    valid_modes = {"screen", "non-screen"}
    bad = set(out["study_mode"].dropna()) - valid_modes
    if bad:
        raise ValueError(f"unknown study_mode values: {', '.join(sorted(bad))}")
    return out.reset_index(drop=True)
