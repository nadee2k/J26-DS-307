"""Focus dashboard data: the trained models' outputs for every past session.

Component 1 only collects behaviour (keyboard / mouse / idle / active
application) and self-reported concentration, so this view deliberately uses
only those — there is no environment or vision data behind it. It re-aggregates
artifacts the pipeline already produced:

* ``features.csv``             per-window interaction states + transitions;
* ``session_transitions.csv``  per-session stability / interruptions;
* ``hmm_session_features.csv`` per-session behavioural regime (HMM);
* ``session_dataset.csv``      self-reported concentration;
* ``state_profiles.csv``       student-facing labels for each state.

Nothing is inferred on the fly here — these are the trained models' outputs for
sessions that already ran, shaped into the payload the standalone ``/focus``
page renders. Served at ``GET /api/focus?source=`` (see :mod:`ui.app`).
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

from ui.live import state_descriptors
from ui.sources import source_info, table_path

TREND_SESSION_LIMIT = 80  # sessions echoed to the charts


# ---------------------------------------------------------------------------
# Small coercion helpers (artifacts are CSV, so everything lands as object/float)
# ---------------------------------------------------------------------------


def _frame(source: str, name: str) -> pd.DataFrame:
    """One artifact as a DataFrame, or an empty frame when it is missing."""
    path = table_path(source, name)
    if path is None or not path.exists():
        return pd.DataFrame()
    try:
        return pd.read_csv(path)
    except (pd.errors.EmptyDataError, ValueError):
        return pd.DataFrame()


def _clean(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        value = float(value)
    if isinstance(value, float):
        return value if np.isfinite(value) else None
    if isinstance(value, np.bool_):
        return bool(value)
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return value


def _number(value: Any, digits: int = 4) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return round(number, digits) if np.isfinite(number) else None


def _integer(value: Any) -> int | None:
    number = _number(value)
    return None if number is None else int(round(number))


def _row(frame: pd.DataFrame, session_id: str) -> dict[str, Any]:
    if frame.empty or "session_id" not in frame.columns:
        return {}
    match = frame[frame["session_id"].astype(str) == session_id]
    return {} if match.empty else {key: _clean(value) for key, value in match.iloc[0].items()}


def _runs(states: list[int]) -> list[int]:
    """Length of each run of identical consecutive states."""
    runs: list[int] = []
    previous: int | None = None
    for state in states:
        if state != previous:
            runs.append(1)
            previous = state
        else:
            runs[-1] += 1
    return runs


def _entropy(states: list[int]) -> float | None:
    if not states:
        return None
    counts = np.array(list(Counter(states).values()), dtype=float)
    probabilities = counts / counts.sum()
    return float(-(probabilities * np.log2(probabilities)).sum())


def _mean(values: list[float | None]) -> float | None:
    usable = [value for value in values if value is not None]
    return round(sum(usable) / len(usable), 3) if usable else None


def _n_states(features: pd.DataFrame, descriptors: dict[int, str], dataset: pd.DataFrame) -> int:
    highest = -1
    if "interaction_state" in features.columns:
        numeric = pd.to_numeric(features["interaction_state"], errors="coerce").dropna()
        if len(numeric):
            highest = max(highest, int(numeric.max()))
    if descriptors:
        highest = max(highest, max(descriptors))
    for column in dataset.columns:
        if column.startswith("state__share_"):
            try:
                highest = max(highest, int(column.rsplit("_", 1)[1]))
            except ValueError:
                continue
    return highest + 1 if highest >= 0 else 0


# ---------------------------------------------------------------------------
# Per-session aggregation
# ---------------------------------------------------------------------------


def _session_row(
    session_id: str,
    group: pd.DataFrame,
    transitions: pd.DataFrame,
    hmm: pd.DataFrame,
    dataset: pd.DataFrame,
    descriptors: dict[int, str],
    n_states: int,
) -> dict[str, Any]:
    states = [
        int(value)
        for value in pd.to_numeric(group.get("interaction_state"), errors="coerce").dropna().tolist()
    ]
    counts = Counter(states)
    total = sum(counts.values())
    runs = _runs(states)

    summary = _row(transitions, session_id)
    regime = _row(hmm, session_id)
    concentration = _row(dataset, session_id)

    dominant = _integer(summary.get("dominant_state"))
    if dominant is None and counts:
        dominant = max(counts, key=counts.get)

    stamp_start = (
        pd.to_datetime(group["window_start"], utc=True, errors="coerce").min()
        if "window_start" in group.columns
        else pd.NaT
    )
    stamp_end = (
        pd.to_datetime(group["window_end"], utc=True, errors="coerce").max()
        if "window_end" in group.columns
        else pd.NaT
    )
    duration = None
    if not pd.isna(stamp_start) and not pd.isna(stamp_end):
        duration = round((stamp_end - stamp_start).total_seconds(), 1)

    context = None
    if "context" in group.columns and group["context"].notna().any():
        context = str(group["context"].dropna().iloc[0])

    mean_run = _number(summary.get("mean_run_length"), 3)
    if mean_run is None and runs:
        mean_run = round(sum(runs) / len(runs), 3)

    entropy = _number(summary.get("state_entropy"), 3)
    if entropy is None:
        entropy = _number(_entropy(states), 3)

    return {
        "sessionId": session_id,
        "participantId": str(group["participant_id"].iloc[0])
        if "participant_id" in group.columns
        else None,
        "context": context,
        "startedAt": None if pd.isna(stamp_start) else stamp_start.isoformat(),
        "endedAt": None if pd.isna(stamp_end) else stamp_end.isoformat(),
        "durationSeconds": duration,
        "nWindows": int(len(group)),
        "dominantState": dominant,
        "dominantShare": round(counts[dominant] / total, 4) if total and dominant is not None else None,
        "dominantDescriptor": descriptors.get(dominant, f"State {dominant}")
        if dominant is not None
        else None,
        "stateShares": [
            {
                "state": state,
                "share": round(counts.get(state, 0) / total, 4) if total else 0.0,
                "descriptor": descriptors.get(state, f"State {state}"),
            }
            for state in range(max(n_states, 1))
        ],
        "sequence": states,
        "nTransitions": _integer(summary.get("n_transitions"))
        if summary.get("n_transitions") is not None
        else max(len(runs) - 1, 0),
        "interruptions": _integer(summary.get("interruption_count")),
        "recoveries": _integer(summary.get("recovery_count")),
        "meanRunLength": mean_run,
        "stateEntropy": entropy,
        "hmmRegime": _integer(regime.get("hmm__dominant")),
        "hmmDwell": _number(regime.get("hmm__mean_dwell"), 3),
        "hmmEntropy": _number(regime.get("hmm__transition_entropy"), 3),
        "concentrationMean": _number(concentration.get("concentration_mean"), 3),
        "nRatings": _integer(concentration.get("n_ratings")),
        "concentrationLabel": _integer(concentration.get("concentration_label")),
    }


def build(source: str) -> dict[str, Any]:
    """Every analysed session with the trained models' outputs, oldest first."""
    info = source_info(source)
    features = _frame(source, "features")
    transitions = _frame(source, "session_transitions")
    hmm = _frame(source, "hmm_session_features")
    dataset = _frame(source, "session_dataset")
    descriptors = state_descriptors(source)
    n_states = _n_states(features, descriptors, dataset)

    sessions: list[dict[str, Any]] = []
    if not features.empty and "session_id" in features.columns:
        features = features.copy()
        if "window_index" in features.columns:
            features["window_index"] = pd.to_numeric(features["window_index"], errors="coerce")
            features = features.sort_values(["session_id", "window_index"])
        sessions = [
            _session_row(
                str(session_id), group, transitions, hmm, dataset, descriptors, n_states
            )
            for session_id, group in features.groupby("session_id", sort=False)
        ]

    sessions.sort(key=lambda item: (item["startedAt"] or "", item["sessionId"]))

    with_concentration = sum(1 for session in sessions if session["concentrationMean"] is not None)
    totals = {
        "sessions": len(sessions),
        "participants": len({s["participantId"] for s in sessions if s["participantId"]}),
        "windows": int(sum(session["nWindows"] for session in sessions)),
        "contexts": sorted({session["context"] for session in sessions if session["context"]}),
        "withConcentration": with_concentration,
        "avgStability": _mean([session["meanRunLength"] for session in sessions]),
        "avgDominantShare": _mean([session["dominantShare"] for session in sessions]),
        "totalInterruptions": int(sum(session["interruptions"] or 0 for session in sessions)),
        "totalRecoveries": int(sum(session["recoveries"] or 0 for session in sessions)),
        "firstSession": sessions[0]["startedAt"] if sessions else None,
        "lastSession": sessions[-1]["startedAt"] if sessions else None,
    }

    notes: list[str] = []
    if not sessions:
        notes.append(
            "No analysed sessions for this source yet — run the pipeline from the Overview tab."
        )
    elif with_concentration < len(sessions):
        notes.append(
            f"Self-reported concentration is available for {with_concentration} of "
            f"{len(sessions)} sessions."
        )

    return {
        "source": source,
        "label": info.get("label") or source,
        "synthetic": bool(info.get("synthetic")),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "nStates": n_states,
        "states": [
            {"state": state, "descriptor": descriptors.get(state, f"State {state}")}
            for state in range(n_states)
        ],
        "totals": totals,
        "sessions": sessions[-TREND_SESSION_LIMIT:],
        "notes": notes,
    }
