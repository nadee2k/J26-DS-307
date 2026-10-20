"""Live behavioural inference for the logged-in student dashboard.

The student app (``Student_DataCollection_UI``) captures keyboard / mouse /
idle / active-application snapshots in the browser while a study session runs
and pushes them here every few seconds. Each push re-runs the single-session
path of :mod:`ui.session_infer` over the accumulated buffer, then augments the
result with the trained HMM (``hmm_model.joblib``), so the dashboard can show a
learner their current interaction state, behavioural regime and how the
session is unfolding — using exactly the models the research pipeline trained.

The payload is deliberately student-facing: plain language, one current state
with a human descriptor derived from ``state_profiles.csv``, compact counters
and a short timeline. Researcher-level detail stays in the demo UI. Field
names are camelCase because the only consumer is the TypeScript dashboard.

Endpoints (mounted in :mod:`ui.app`):

    GET    /api/live/ready?source=     trained artefacts availability
    POST   /api/live/push              append snapshots, get a fresh readout
    GET    /api/live/state?session_id= last readout without pushing anything
    DELETE /api/live/session?session_id=  drop a buffered session

The buffer lives in memory only — nothing here writes to the database; the
supabase ``behavior_logs`` rows written by the browser remain the record.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any

import joblib
import numpy as np
import pandas as pd

from src.models import sequential as sequential_model
from ui import session_infer
from ui.sources import dirs_for, read_table, source_info

MAX_BUFFER_ROWS = 50_000            # ~14 h of 1 s snapshots per session
MAX_PUSH_ROWS = 2_000               # rows accepted in a single push
SESSION_TTL_SECONDS = 12 * 3600     # idle buffers are dropped after 12 h
TIMELINE_WINDOWS = 40               # windows echoed back to the dashboard
MIN_SNAPSHOTS = 2                   # fewer rows than this cannot form a window

SNAPSHOT_COLUMNS = [
    "created_at",
    "session_id",
    "keyboard_count",
    "mouse_distance",
    "mouse_clicks",
    "idle_time",
    "active_application",
]

# ---------------------------------------------------------------------------
# Student-facing state descriptors (from the trained state profiles)
# ---------------------------------------------------------------------------

_TYPING_WORDS = {"Low": "little typing", "Medium": "moderate typing", "High": "frequent typing"}
_MOUSE_WORDS = {
    "Low": "light mouse use",
    "Medium": "moderate mouse use",
    "High": "active mouse use",
}
_IDLE_WORDS = {"Low": "rarely idle", "Medium": "some idle time", "High": "mostly idle"}
_SWITCH_WORDS = {
    "Low": "stays in one app",
    "Medium": "occasional app switches",
    "High": "switches apps often",
}


def _level(value: Any) -> str | None:
    """Coerce a profile level ('Low' / 'Medium' / 'High') to its canonical form."""
    if value is None:
        return None
    try:
        if not np.isfinite(float(value)):
            return None
    except (TypeError, ValueError):
        pass
    text = str(value).strip().capitalize()
    return text if text in ("Low", "Medium", "High") else None


def _describe_state(profile: dict[str, Any] | None, state: int) -> str:
    """One plain-language phrase per trained state, e.g. 'frequent typing · rarely idle'."""
    if not profile:
        return f"State {state}"
    parts = []
    for column, words in (
        ("typing_rate_level", _TYPING_WORDS),
        ("mean_mouse_velocity_level", _MOUSE_WORDS),
        ("idle_ratio_level", _IDLE_WORDS),
        ("application_switch_frequency_level", _SWITCH_WORDS),
    ):
        level = _level(profile.get(column))
        if level:
            parts.append(words[level])
    return " · ".join(parts) if parts else f"State {state}"


def state_descriptors(source: str) -> dict[int, str]:
    """``{state index: student-facing descriptor}`` from ``state_profiles.csv``."""
    table = read_table(source, "state_profiles", limit=64)
    descriptors: dict[int, str] = {}
    for row in table.get("rows") or []:
        try:
            state = int(row.get("state"))
        except (TypeError, ValueError):
            continue
        descriptors[state] = _describe_state(row, state)
    return descriptors


# ---------------------------------------------------------------------------
# Trained HMM (cached by file mtime so re-runs are picked up automatically)
# ---------------------------------------------------------------------------

_HMM_CACHE: dict[str, dict[str, Any]] = {}
_HMM_CACHE_LOCK = threading.Lock()


def hmm_path(source: str):
    return dirs_for(source)["models"] / "hmm_model.joblib"


def _load_hmm(source: str) -> tuple[Any | None, dict[str, Any]]:
    """Return ``(model_or_None, info)`` for a source's trained HMM."""
    path = hmm_path(source)
    info: dict[str, Any] = {"path": str(path), "available": path.exists()}
    if not path.exists():
        return None, info
    mtime = path.stat().st_mtime
    with _HMM_CACHE_LOCK:
        cached = _HMM_CACHE.get(source)
        if cached is not None and cached["mtime"] == mtime:
            model = cached["model"]
        else:
            try:
                model = joblib.load(path)
            except Exception as exc:  # noqa: BLE001 - surfaced verbatim in the UI
                return None, {**info, "error": str(exc)}
            _HMM_CACHE[source] = {"model": model, "mtime": mtime}
    return model, {
        **info,
        "n_hidden": int(getattr(model, "n_hidden", 0) or 0),
        "n_symbols": int(getattr(model, "n_symbols", 0) or 0),
    }


def _decode_regime(model: Any, states: list[int]) -> dict[str, Any] | None:
    """Decode the observed-state sequence into hidden regimes.

    The current regime is the smoothed (forward) posterior at the latest
    window, so the confidence the dashboard shows is P(regime | all windows).
    """
    if model is None or not states:
        return None
    obs = np.asarray(states, dtype=int)
    n_symbols = int(getattr(model, "n_symbols", 0) or 0)
    if obs.min() < 0 or (n_symbols and obs.max() >= n_symbols):
        return None  # states from a newer clustering than the saved HMM

    hidden = model.decode(obs)
    log_start = sequential_model._log(model.startprob_)
    log_trans = sequential_model._log(model.transmat_)
    log_emit = sequential_model._log(model.emission_)
    log_alpha, _ = model._forward(obs, log_start, log_trans, log_emit)
    posterior = np.exp(log_alpha[-1] - sequential_model._lse(log_alpha[-1]))
    current = int(hidden[-1])
    return {
        "current": current,
        "confidence": float(posterior[current]),
        "probabilities": [round(float(value), 4) for value in posterior],
        "nHidden": int(model.n_hidden),
        "sequence": [int(value) for value in hidden],
    }


# ---------------------------------------------------------------------------
# In-memory session buffers
# ---------------------------------------------------------------------------


class _LiveSession:
    """One study session's accumulated snapshots and last readout."""

    def __init__(
        self,
        session_id: str,
        participant_id: str,
        source: str,
        context: str | None,
        window_seconds: int,
    ) -> None:
        self.session_id = session_id
        self.source = source
        self.participant_id = participant_id
        self.context = context
        self.window_seconds = window_seconds
        self.frame = pd.DataFrame(columns=SNAPSHOT_COLUMNS)
        self.last_payload: dict[str, Any] | None = None
        self.updated_at = time.time()


class _LiveStore:
    """Thread-safe ``{session_id: _LiveSession}`` with a TTL sweep."""

    def __init__(self) -> None:
        self._sessions: dict[str, _LiveSession] = {}
        self._lock = threading.Lock()

    def get_or_create(self, session_id: str, **kwargs: Any) -> _LiveSession:
        with self._lock:
            self._prune_locked()
            existing = self._sessions.get(session_id)
            # A new source or participant for the same id starts a fresh buffer.
            if existing is not None and (
                existing.source != kwargs.get("source")
                or existing.participant_id != kwargs.get("participant_id")
            ):
                existing = None
            if existing is None:
                existing = _LiveSession(session_id=session_id, **kwargs)
                self._sessions[session_id] = existing
            else:
                existing.window_seconds = kwargs.get("window_seconds", existing.window_seconds)
                existing.context = kwargs.get("context") or existing.context
            return existing

    def get(self, session_id: str) -> _LiveSession | None:
        with self._lock:
            self._prune_locked()
            return self._sessions.get(session_id)

    def clear(self, session_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(session_id, None) is not None

    def _prune_locked(self) -> None:
        cutoff = time.time() - SESSION_TTL_SECONDS
        expired = [key for key, value in self._sessions.items() if value.updated_at < cutoff]
        for key in expired:
            self._sessions.pop(key, None)


_STORE = _LiveStore()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def ready(source: str) -> dict[str, Any]:
    """Whether a source can serve live readouts (state model + optional HMM)."""
    state = session_infer.ready(source)
    path = hmm_path(source)
    state["hmm_model"] = {"path": str(path), "available": path.exists()}
    return state


def push(request: dict[str, Any]) -> dict[str, Any]:
    """Append snapshots to a session's buffer and return the fresh readout."""
    source = str(request.get("source") or "real")
    info = source_info(source)  # KeyError -> unknown source, handled by the route

    session_id = str(request.get("session_id") or "").strip()
    participant_id = str(request.get("participant_id") or "").strip()
    if not session_id or not participant_id:
        raise session_infer.SessionAnalysisError("session_id and participant_id are required.")

    context = str(request.get("context") or "").strip() or None
    context_code = request.get("context_code")

    state = session_infer.ready(source)
    if not state["ready"]:
        raise session_infer.ModelNotReadyError(state["message"])

    # Window length changes the scale of count features, so unless the caller
    # asks for something else we reuse the window the state model was fitted on
    # (keeps ``state 3`` meaning exactly what it means in the dashboard).
    requested_window = request.get("window_seconds")
    window_seconds = int(requested_window or state.get("window_seconds") or 60)
    window_seconds = max(15, min(window_seconds, 600))

    session = _STORE.get_or_create(
        session_id,
        source=source,
        participant_id=participant_id,
        context=context,
        window_seconds=window_seconds,
    )

    incoming = pd.DataFrame(
        request.get("snapshots") or [], columns=SNAPSHOT_COLUMNS
    ).head(MAX_PUSH_ROWS)
    if not incoming.empty:
        incoming["session_id"] = session_id
        if "active_application" not in incoming or incoming["active_application"].isna().all():
            incoming["active_application"] = "Unknown"
        combined = (
            incoming
            if session.frame.empty
            else pd.concat([session.frame, incoming], ignore_index=True)
        )
        combined = combined.drop_duplicates(subset="created_at", keep="last")
        combined = combined.sort_values("created_at").tail(MAX_BUFFER_ROWS)
        session.frame = combined.reset_index(drop=True)
    session.updated_at = time.time()

    if len(session.frame) < MIN_SNAPSHOTS:
        raise session_infer.SessionAnalysisError(
            "Still warming up — a first readout needs a few seconds of activity."
        )

    analysis = session_infer.analyze(
        session.frame,
        source=source,
        participant_id=participant_id,
        session_id=session_id,
        context=context,
        context_code=int(context_code) if context_code is not None else None,
        window_seconds=window_seconds,
        with_downloads=False,
    )
    payload = _shape(analysis, session, info)
    session.last_payload = payload
    session.context = context or analysis.get("session_summary", {}).get("context")
    return payload


def session_state(session_id: str) -> dict[str, Any] | None:
    """The last readout of a session without recomputing anything."""
    session = _STORE.get(session_id)
    if session is None or session.last_payload is None:
        return None
    return {"ok": True, "insight": session.last_payload}


def clear_session(session_id: str) -> dict[str, Any]:
    """Drop a session's buffer (called when a study session ends)."""
    return {"ok": True, "cleared": _STORE.clear(session_id)}


# ---------------------------------------------------------------------------
# Shaping: research payload -> student payload
# ---------------------------------------------------------------------------


def _shape(analysis: dict[str, Any], session: _LiveSession, info: dict[str, Any]) -> dict[str, Any]:
    meta = analysis.get("meta") or {}
    summary = analysis.get("session_summary") or {}
    model_meta = meta.get("model") or {}

    descriptors = state_descriptors(session.source)

    # Ordered state sequence -> current state + HMM regime.
    timeline_rows = sorted(
        analysis.get("timeline") or [], key=lambda row: int(row.get("window_index") or 0)
    )
    states = [int(row["state"]) for row in timeline_rows if row.get("state") is not None]
    current_state = states[-1] if states else None

    hmm_model, _hmm_info = _load_hmm(session.source)
    regime = _decode_regime(hmm_model, states)

    shares = [
        {
            "state": int(entry["state"]),
            "share": round(float(entry["share"]), 4),
            "descriptor": descriptors.get(int(entry["state"]), f"State {entry['state']}"),
        }
        for entry in analysis.get("state_shares") or []
    ]

    elapsed: float | None = None
    if len(session.frame) > 1:
        try:
            start = pd.to_datetime(session.frame["created_at"].iloc[0])
            end = pd.to_datetime(session.frame["created_at"].iloc[-1])
            elapsed = round((end - start).total_seconds(), 1)
        except (ValueError, TypeError):
            elapsed = None

    return {
        "ok": True,
        "sessionId": meta.get("session_id") or session.session_id,
        "participantId": meta.get("participant_id") or session.participant_id,
        "context": meta.get("context") or session.context,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "windowSeconds": int(meta.get("window_seconds") or session.window_seconds),
        "snapshotCount": int(meta.get("n_events") or len(session.frame)),
        "windows": int(meta.get("n_windows") or len(states)),
        "elapsedSeconds": elapsed,
        "currentState": current_state,
        "currentStateDescriptor": descriptors.get(current_state, f"State {current_state}")
        if current_state is not None
        else None,
        "stateShares": shares,
        "timeline": [
            {
                "windowIndex": int(row.get("window_index") or index),
                "state": int(row["state"]) if row.get("state") is not None else None,
                "transition": bool(row.get("is_transition")),
            }
            for index, row in enumerate(timeline_rows[-TIMELINE_WINDOWS:])
        ],
        "transitions": {
            "dominantState": _as_int(summary.get("dominant_state")),
            "dominantShare": _as_float(summary.get("dominant_share")),
            "count": _as_int(summary.get("n_transitions")),
            "changeRate": _as_float(summary.get("state_change_rate")),
            "interruptions": _as_int(summary.get("interruption_count")),
            "recoveries": _as_int(summary.get("recovery_count")),
            "meanStateDuration": _as_float(summary.get("mean_state_duration")),
        },
        "regime": regime,
        "summary": str(summary.get("behavioural_summary") or "") or None,
        "model": {
            "source": session.source,
            "sourceLabel": info.get("label") or session.source,
            "synthetic": bool(info.get("synthetic")),
            "stateModel": str(model_meta.get("state_model") or ""),
            "stateMethod": model_meta.get("state_method"),
            "trainedAt": model_meta.get("finished_at"),
            "hmmAvailable": bool(_hmm_info.get("available")),
            "hmmHidden": regime.get("nHidden") if regime else _hmm_info.get("n_hidden"),
        },
    }


def _as_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if np.isfinite(number) else None


def _as_int(value: Any) -> int | None:
    number = _as_float(value)
    return None if number is None else int(round(number))
