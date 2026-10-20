"""Single-session inference behind the Session Analyzer tab.

A researcher can upload the behaviour events of *one* session and get the
Component 1 behavioural output immediately, without re-running the batch
pipeline. Every stage is reused from the batch path in :mod:`src.pipeline`::

    clean_behavior_logs -> synchronize_events -> create_time_windows
        -> build_window_features -> trained state model
        -> add_state_transitions -> add_context_features
        -> build_session_dataset -> build_outputs / validate_output

The only stage that differs is the state assignment: instead of re-clustering,
the ``state_model.joblib`` / ``state_scaler.joblib`` written by the last
successful run of the selected source is loaded and applied, so ``state 3``
keeps exactly the meaning it has in the dashboard.
"""

from __future__ import annotations

import io
import json
import math
import tempfile
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from src.config import CONTEXT_CODES, DEFAULT_WINDOW_SECONDS, RAW_DIR
from src.context.context_model import add_context_features
from src.features.feature_builder import build_window_features
from src.integration.export import (
    SESSION_OUTPUT_SCHEMA,
    WINDOW_OUTPUT_SCHEMA,
    build_outputs,
    validate_output,
)
from src.models.dataset import build_session_dataset
from src.preprocessing.cleaner import clean_behavior_logs
from src.preprocessing.synchronizer import synchronize_events
from src.preprocessing.windowing import create_time_windows
from src.states.state_discovery import DEFAULT_STATE_FEATURES
from src.transitions.transition_model import (
    add_state_transitions,
    session_transition_summary,
    transition_probabilities,
)
from ui.sources import SOURCES, dirs_for, read_json, source_info

# ---------------------------------------------------------------------------
# Limits / paths
# ---------------------------------------------------------------------------

MAX_UPLOAD_BYTES = 50 * 1024 * 1024      # reject uploads larger than 50 MB
MAX_UPLOAD_ROWS = 200_000                # reject absurdly long event tables
MAX_WINDOW_ROWS_IN_RESPONSE = 500        # cap the per-window payload
DOWNLOAD_TTL_SECONDS = 3600              # generated CSVs live for one hour
UPLOAD_DIR = Path(tempfile.gettempdir()) / "focustrack_uploads"

DEFAULT_CONTEXT = "study"                # fallback used by the summary writer

TIME_ALIASES = ("created_at", "timestamp", "datetime", "time", "recorded_at")
SESSION_ALIASES = ("session_id", "session", "sessionId", "sessionid")
PARTICIPANT_ALIASES = ("participant_id", "student_id", "participant", "user_id")
CONTEXT_ALIASES = ("context", "task_type", "activity")

# Per-window columns surfaced in the JSON payload (all optional).
WINDOW_FEATURE_VIEW = [
    "participant_id",
    "session_id",
    "context",
    "context_code",
    "window_index",
    "window_start",
    "window_end",
    "interaction_state",
    "previous_state",
    "transition_type",
    "state_duration",
    "typing_rate",
    "key_event_count",
    "mouse_distance",
    "mouse_clicks",
    "idle_ratio",
    "application_switch_count",
    "unique_application_count",
    "application_switch_frequency",
    "mean_keyboard_count",
    "burst_count",
    "mean_mouse_velocity",
    "mean_idle_time",
    "session_progress",
    "n_snapshots",
]


class SessionAnalysisError(ValueError):
    """Raised for user-correctable problems with an uploaded session file."""


class ModelNotReadyError(SessionAnalysisError):
    """Raised when the selected source has no trained state model yet."""


# ---------------------------------------------------------------------------
# Trained artefacts
# ---------------------------------------------------------------------------


def model_paths(source: str) -> dict[str, Path]:
    """Where the trained state artefacts of a source live."""
    models = dirs_for(source)["models"]
    return {
        "state_model": models / "state_model.joblib",
        "state_scaler": models / "state_scaler.joblib",
    }


def _n_states_from(model: Any) -> int | None:
    for attr in ("n_clusters", "n_components"):
        value = getattr(model, attr, None)
        if isinstance(value, (int, np.integer)):
            return int(value)
    labels = getattr(model, "labels_", None)
    if labels is not None and len(labels):
        return int(np.max(labels)) + 1
    return None


def feature_columns(scaler: Any = None, source: str | None = None) -> list[str]:
    """Columns (and order) the trained scaler was fitted on.

    Preference order: the scaler's own ``feature_names_in_`` (exact fit-time
    order), then ``state_feature_columns`` in the run manifest, then the
    module-level defaults.
    """
    raw_names = getattr(scaler, "feature_names_in_", None)
    if raw_names is not None:
        names = [str(name) for name in list(raw_names)]
        if names:
            return names
    if source:
        manifest = read_json(source, "run_manifest").get("data") or {}
        saved = manifest.get("state_feature_columns")
        if saved:
            return [str(name) for name in saved]
    return list(DEFAULT_STATE_FEATURES)


def ready(source: str) -> dict[str, Any]:
    """Report whether a source can be used for single-session inference."""
    info = source_info(source)  # raises KeyError for an unknown source
    paths = model_paths(source)
    missing = [name for name, path in paths.items() if not path.exists()]

    scaler = None
    columns: list[str] = []
    n_states: int | None = None
    state_method: str | None = None
    if not missing:
        try:
            scaler = joblib.load(paths["state_scaler"])
            model = joblib.load(paths["state_model"])
            columns = feature_columns(scaler, source)
            n_states = _n_states_from(model)
            state_method = type(model).__name__
        except Exception as exc:  # noqa: BLE001 - surfaced verbatim in the UI
            missing.append(f"unreadable model artefacts ({exc})")

    manifest = read_json(source, "run_manifest").get("data") or {}
    params = manifest.get("params") or {}

    if missing:
        message = (
            f"No trained state model for '{info['label']}'. "
            "Run the pipeline on this source first — single-session analysis "
            "reuses its state_model.joblib + state_scaler.joblib."
        )
    else:
        message = (
            f"Trained state model ready ({state_method}, {n_states} states, "
            f"{len(columns)} feature columns)."
        )

    return {
        "source": source,
        "label": info["label"],
        "synthetic": info["synthetic"],
        "ready": not missing,
        "missing": missing,
        "state_model": str(paths["state_model"]),
        "state_scaler": str(paths["state_scaler"]),
        "n_states": n_states,
        "state_method": state_method,
        "feature_columns": columns,
        "window_seconds": int(params.get("window_seconds") or DEFAULT_WINDOW_SECONDS),
        "finished_at": manifest.get("finished_at"),
        "message": message,
    }


def assign_states(features: pd.DataFrame, source: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Apply the trained state model/scaler of ``source`` to window features."""
    state = ready(source)
    if not state["ready"]:
        raise ModelNotReadyError(state["message"])

    paths = model_paths(source)
    scaler = joblib.load(paths["state_scaler"])
    model = joblib.load(paths["state_model"])
    columns = feature_columns(scaler, source)

    matrix = pd.DataFrame(index=features.index)
    missing_columns: list[str] = []
    for column in columns:
        if column in features.columns:
            matrix[column] = pd.to_numeric(features[column], errors="coerce").fillna(0.0)
        else:
            matrix[column] = 0.0
            missing_columns.append(column)

    expected = getattr(scaler, "n_features_in_", None)
    if expected is not None and matrix.shape[1] != int(expected):
        raise SessionAnalysisError(
            f"The trained scaler expects {int(expected)} feature columns but "
            f"{matrix.shape[1]} were assembled — re-run the pipeline for "
            f"'{source}' so the model artefacts match the current features."
        )

    labels = model.predict(scaler.transform(matrix))
    out = features.copy()
    out["interaction_state"] = np.asarray(labels, dtype=int)

    n_states = _n_states_from(model) or int(out["interaction_state"].max()) + 1
    return out, {
        "n_states": max(int(n_states), int(out["interaction_state"].max()) + 1),
        "feature_columns": columns,
        "missing_feature_columns": missing_columns,
        "state_model": str(paths["state_model"]),
        "state_scaler": str(paths["state_scaler"]),
        "state_method": state.get("state_method") or type(model).__name__,
        "finished_at": state.get("finished_at"),
    }


# ---------------------------------------------------------------------------
# Upload normalisation
# ---------------------------------------------------------------------------


def _first_present(frame: pd.DataFrame, aliases: tuple[str, ...]) -> str | None:
    lowered = {str(column).strip().lower(): column for column in frame.columns}
    for alias in aliases:
        if alias in lowered:
            return lowered[alias]
    return None


def normalize_events(
    frame: pd.DataFrame,
    *,
    participant_id: str | None = None,
    session_id: str | None = None,
    session_hint: str | None = None,
    context: str | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Coerce an uploaded event table into the raw ``behavior_logs`` shape.

    ``session_id`` (from the form) always wins and filters the file;
    ``session_hint`` (the upload's file name) is only used when the file has no
    session column at all. Returns the normalised frame plus the identifiers
    used for the derived ``study_sessions`` / ``students`` tables.
    """
    if frame is None or frame.empty:
        raise SessionAnalysisError("The uploaded file contains no rows.")

    if len(frame) > MAX_UPLOAD_ROWS:
        raise SessionAnalysisError(
            f"The file has {len(frame)} rows (limit {MAX_UPLOAD_ROWS}). "
            "Upload a single session's slice."
        )

    out = frame.copy()
    out.columns = [str(column).strip() for column in out.columns]

    # --- timestamps -------------------------------------------------------
    time_col = _first_present(out, TIME_ALIASES)
    if time_col is None:
        raise SessionAnalysisError(
            "No timestamp column found. Expected one of: "
            + ", ".join(TIME_ALIASES)
            + "."
        )
    if time_col != "created_at":
        out = out.rename(columns={time_col: "created_at"})

    # --- session id -------------------------------------------------------
    file_session = _first_present(out, SESSION_ALIASES)
    if file_session is not None and file_session != "session_id":
        out = out.rename(columns={file_session: "session_id"})
        file_session = "session_id"

    if session_id:
        wanted = str(session_id)
        if file_session is not None:
            found = out["session_id"].dropna().astype(str)
            mask = found == wanted
            if not mask.any():
                known = sorted(found.unique())[:5]
                raise SessionAnalysisError(
                    f"No rows with session_id '{wanted}'. "
                    f"The file contains: {', '.join(map(str, known)) or 'none'}."
                )
            out = out.loc[mask.values].copy()
        else:
            out["session_id"] = wanted
    elif file_session is None:
        if session_hint:
            out["session_id"] = str(session_hint)
        else:
            raise SessionAnalysisError(
                "The file has no session_id column — enter a Session ID in the form."
            )

    if out.empty:
        raise SessionAnalysisError("No rows left for the selected session_id.")

    out["session_id"] = out["session_id"].astype(str)

    # --- participant id ---------------------------------------------------
    file_participant = _first_present(out, PARTICIPANT_ALIASES)
    if participant_id:
        out["participant_id"] = str(participant_id)
    elif file_participant is not None:
        if file_participant != "participant_id":
            out = out.rename(columns={file_participant: "participant_id"})
        out["participant_id"] = out["participant_id"].astype(str)
    else:
        out["participant_id"] = "P-unknown"

    # --- context ----------------------------------------------------------
    file_context = _first_present(out, CONTEXT_ALIASES)
    resolved_context = (str(context).strip() if context else None) or None
    if resolved_context is None and file_context is not None:
        values = out[file_context].dropna()
        if not values.empty:
            resolved_context = str(values.iloc[0])

    # --- dtypes -----------------------------------------------------------
    for column in ("keyboard_count", "mouse_clicks"):
        if column in out.columns:
            out[column] = pd.to_numeric(out[column], errors="coerce")
    for column in ("mouse_distance", "idle_time"):
        if column in out.columns:
            out[column] = pd.to_numeric(out[column], errors="coerce")
    if "active_application" not in out.columns:
        out["active_application"] = "Unknown"

    meta = {
        "session_id": str(out["session_id"].iloc[0]),
        "participant_id": str(out["participant_id"].iloc[0]),
        "context": resolved_context,
        "rows_in_file": int(len(out)),
    }
    return out, meta


# ---------------------------------------------------------------------------
# Core analysis
# ---------------------------------------------------------------------------


def _records(frame: pd.DataFrame, limit: int | None = None) -> list[dict[str, Any]]:
    view = frame if limit is None else frame.head(limit)
    return json.loads(view.to_json(orient="records", date_format="iso"))


def _json_safe(obj: Any) -> Any:
    """Make sure the payload survives ``json.dumps(..., allow_nan=False)``."""
    if isinstance(obj, dict):
        return {str(key): _json_safe(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_json_safe(value) for value in obj]
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        obj = float(obj)
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if obj is None or obj is pd.NA:
        return None
    if isinstance(obj, (str, bool, int)):
        return obj
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.isoformat()
    try:
        if pd.isna(obj):  # NaT / numpy nan scalars
            return None
    except (TypeError, ValueError):  # non-scalar fallback
        pass
    return str(obj)


def _pad_state_shares(dataset: pd.DataFrame, n_states: int) -> pd.DataFrame:
    """Every trained state gets a share column, even if this session missed it."""
    if dataset.empty:
        return dataset
    out = dataset.copy()
    for state in range(max(int(n_states), 1)):
        column = f"state__share_{state}"
        if column not in out.columns:
            out[column] = 0.0
    shares = sorted(
        [column for column in out.columns if column.startswith("state__share_")],
        key=lambda column: int(column.rsplit("_", 1)[-1]),
    )
    others = [column for column in out.columns if column not in shares]
    return out[others + shares]


def analyze(
    frame: pd.DataFrame,
    *,
    source: str,
    participant_id: str | None = None,
    session_id: str | None = None,
    session_hint: str | None = None,
    context: str | None = None,
    context_code: int | None = None,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
    with_downloads: bool = True,
) -> dict[str, Any]:
    """Run the minimal Component 1 path over one session's events.

    ``with_downloads=False`` skips writing the temporary integration CSVs —
    used by the live student dashboard, which polls this function and has no
    download UI.
    """
    started = time.monotonic()
    info = source_info(source)  # raises KeyError for an unknown source
    window_seconds = int(window_seconds)
    if not 15 <= window_seconds <= 600:
        raise SessionAnalysisError("window_seconds must be between 15 and 600.")

    state = ready(source)
    if not state["ready"]:
        raise ModelNotReadyError(state["message"])

    # 1. normalise + clean ------------------------------------------------
    events_raw, ids = normalize_events(
        frame,
        participant_id=participant_id,
        session_id=session_id,
        session_hint=session_hint,
        context=context,
    )
    behavior = clean_behavior_logs(events_raw)
    if behavior.empty:
        raise SessionAnalysisError(
            "No usable rows after cleaning — every row needs a parseable "
            "timestamp and a session_id."
        )

    session_ids = behavior["session_id"].dropna().astype(str).unique()
    if len(session_ids) > 1:
        raise SessionAnalysisError(
            f"The file contains {len(session_ids)} sessions "
            f"({', '.join(map(str, session_ids[:5]))}…). Upload one session at "
            "a time or enter a Session ID to filter."
        )

    resolved_context = ids["context"] or DEFAULT_CONTEXT
    participant = ids["participant_id"]
    session = ids["session_id"]

    # 2. derive the sibling tables the synchroniser expects ---------------
    sessions_table = pd.DataFrame(
        [
            {
                "id": session,
                "student_id": participant,
                "task_type": resolved_context,
                "started_at": behavior["created_at"].min(),
                "ended_at": behavior["created_at"].max(),
                "status": "completed",
            }
        ]
    )
    students_table = pd.DataFrame([{"participant_id": participant}])

    # 3. synchronise -> window -> features --------------------------------
    events = synchronize_events(behavior, sessions_table, students_table)
    if events.empty:
        raise SessionAnalysisError("No events left after synchronisation.")
    events["context"] = resolved_context

    windows = create_time_windows(events, window_seconds)
    features = build_window_features(windows, concentration=None)
    if features.empty:
        raise SessionAnalysisError("Could not build time windows from the upload.")

    # 4. interaction states from the trained artefacts ---------------------
    features, state_meta = assign_states(features, source)
    features = add_state_transitions(features)
    features = add_context_features(features, n_states=state_meta["n_states"])
    if context_code is not None:
        features["context_code"] = int(context_code)
    elif resolved_context in CONTEXT_CODES:
        features["context_code"] = CONTEXT_CODES[resolved_context]

    # 5. session dataset + integration outputs -----------------------------
    dataset, _groups = build_session_dataset(
        features, concentration=None, require_label=False
    )
    dataset = _pad_state_shares(dataset, state_meta["n_states"])
    if dataset.empty:
        raise SessionAnalysisError("The session produced no dataset row.")

    outputs = build_outputs(features, dataset, predictions=None)
    window_out = outputs["behavioural_output_window"]
    session_out = outputs["behavioural_output_session"]
    validation = {
        "window": validate_output(window_out, WINDOW_OUTPUT_SCHEMA),
        "session": validate_output(session_out, SESSION_OUTPUT_SCHEMA),
    }

    # 6. views the UI renders ---------------------------------------------
    n_states = state_meta["n_states"]
    counts = features["interaction_state"].value_counts()
    state_shares = [
        {
            "state": state_index,
            "windows": int(counts.get(state_index, 0)),
            "share": float(counts.get(state_index, 0)) / max(len(features), 1),
        }
        for state_index in range(n_states)
    ]

    matrix = [[0.0 for _ in range(n_states)] for _ in range(n_states)]
    for _, row in transition_probabilities(features).iterrows():
        source_state, target_state = int(row["from_state"]), int(row["to_state"])
        if 0 <= source_state < n_states and 0 <= target_state < n_states:
            matrix[source_state][target_state] = float(row["probability"])
    transition_rows = _records(transition_probabilities(features))

    transition_summary = session_transition_summary(features)
    summary_row = (
        transition_summary.iloc[0].to_dict() if not transition_summary.empty else {}
    )
    session_row = _records(session_out.head(1))
    session_row = session_row[0] if session_row else {}

    dataset_row = dataset.iloc[0]
    duration = dataset_row.get("session_duration_seconds")
    dominant = int(summary_row.get("dominant_state", session_row.get("dominant_state", 0)) or 0)
    dominant_share = next(
        (entry["share"] for entry in state_shares if entry["state"] == dominant), 0.0
    )

    # ``session_transition_summary`` reports structural counts (a state change
    # / an A->B->A return), while the integration row aggregates the same
    # measures per window for Component 2. Report both so nothing is ambiguous.
    contract_interruptions = _safe_float(session_row.get("interruption_count"))
    contract_recoveries = _safe_float(session_row.get("recovery_count"))

    view_columns = [column for column in WINDOW_FEATURE_VIEW if column in features.columns]
    timeline_columns = [
        column
        for column in (
            "window_index",
            "window_start",
            "interaction_state",
            "transition_type",
            "is_transition",
            "state_duration",
            "n_snapshots",
        )
        if column in features.columns
    ]
    ordered = (
        features.sort_values("window_index")
        if "window_index" in features.columns
        else features
    )
    timeline = _records(
        ordered[timeline_columns].rename(columns={"interaction_state": "state"})
    )

    if with_downloads:
        key = write_downloads(session_out, window_out)
        download: dict[str, str] | None = {
            "session_csv": f"/api/session/download/session?key={key}",
            "window_csv": f"/api/session/download/window?key={key}",
        }
    else:
        download = None

    payload = {
        "ok": True,
        "meta": {
            "source": source,
            "label": info["label"],
            "synthetic": info["synthetic"],
            "participant_id": participant,
            "session_id": session,
            "context": resolved_context,
            "context_code": int(context_code)
            if context_code is not None
            else (CONTEXT_CODES.get(resolved_context)),
            "window_seconds": window_seconds,
            "n_events": int(len(events)),
            "n_windows": int(len(features)),
            "states": n_states,
            "model": {
                "state_model": state_meta["state_model"],
                "state_scaler": state_meta["state_scaler"],
                "state_method": state_meta["state_method"],
                "feature_columns": state_meta["feature_columns"],
                "missing_feature_columns": state_meta["missing_feature_columns"],
                "finished_at": state_meta["finished_at"],
            },
            "duration_seconds": round(time.monotonic() - started, 3),
        },
        "window_features": _records(
            features[view_columns], limit=MAX_WINDOW_ROWS_IN_RESPONSE
        ),
        "window_features_total": int(len(features)),
        "window_features_truncated": bool(len(features) > MAX_WINDOW_ROWS_IN_RESPONSE),
        "window_integration": _records(window_out, limit=MAX_WINDOW_ROWS_IN_RESPONSE),
        "window_integration_total": int(len(window_out)),
        "session_integration": session_row,
        "session_summary": {
            "participant_id": participant,
            "session_id": session,
            "context": resolved_context,
            "context_code": int(context_code)
            if context_code is not None
            else (CONTEXT_CODES.get(resolved_context)),
            "session_duration_seconds": _safe_float(duration),
            "n_events": int(len(events)),
            "n_windows": int(len(features)),
            "window_seconds": window_seconds,
            "dominant_state": dominant,
            "dominant_share": float(dominant_share),
            "states_observed": [
                int(value) for value in sorted(features["interaction_state"].unique())
            ],
            "state_entropy": _safe_float(summary_row.get("state_entropy")),
            "state_change_rate": _safe_float(session_row.get("state_change_rate")),
            "mean_state_duration": _safe_float(
                session_row.get("mean_state_duration")
            ),
            "n_transitions": _safe_int(summary_row.get("n_transitions")),
            "n_runs": _safe_int(summary_row.get("n_runs")),
            "max_run_length": _safe_int(summary_row.get("max_run_length")),
            "mean_run_length": _safe_float(summary_row.get("mean_run_length")),
            "interruption_count": _safe_int(summary_row.get("interruption_count")),
            "recovery_count": _safe_int(summary_row.get("recovery_count")),
            "row_interruption_count": contract_interruptions,
            "row_recovery_count": contract_recoveries,
            "behavioural_summary": str(session_row.get("behavioural_summary") or ""),
        },
        "timeline": timeline,
        "transitions": {
            "labels": [f"state {index}" for index in range(n_states)],
            "matrix": matrix,
            "counts": transition_rows,
            "summary": summary_row,
        },
        "state_shares": state_shares,
        "validation": validation,
        "download": download,
    }
    return _json_safe(payload)


def _safe_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _safe_int(value: Any) -> int | None:
    number = _safe_float(value)
    return None if number is None else int(round(number))


# ---------------------------------------------------------------------------
# Downloads (temporary integration CSVs)
# ---------------------------------------------------------------------------

_DOWNLOAD_LOCK = threading.Lock()
_DOWNLOADS: dict[str, dict[str, Any]] = {}


def write_downloads(session_out: pd.DataFrame, window_out: pd.DataFrame) -> str:
    """Persist the two integration CSVs and return an opaque download key."""
    key = uuid.uuid4().hex[:16]
    directory = UPLOAD_DIR / key
    directory.mkdir(parents=True, exist_ok=True)
    session_path = directory / "behavioural_output_session.csv"
    window_path = directory / "behavioural_output_window.csv"
    session_out.to_csv(session_path, index=False)
    window_out.to_csv(window_path, index=False)

    now = time.time()
    with _DOWNLOAD_LOCK:
        for existing in [
            k for k, v in _DOWNLOADS.items() if now - v["created"] > DOWNLOAD_TTL_SECONDS
        ]:
            _DOWNLOADS.pop(existing, None)
        _DOWNLOADS[key] = {
            "session": session_path,
            "window": window_path,
            "created": now,
        }
    return key


def download_path(key: str, kind: str) -> Path | None:
    """Resolve a download key + kind (``session`` / ``window``) to a CSV."""
    if kind not in ("session", "window"):
        return None
    with _DOWNLOAD_LOCK:
        entry = _DOWNLOADS.get(key)
        if entry is None:
            return None
        if time.time() - entry["created"] > DOWNLOAD_TTL_SECONDS:
            _DOWNLOADS.pop(key, None)
            return None
        path = entry[kind]
    return path if path.exists() else None


# ---------------------------------------------------------------------------
# Sample upload
# ---------------------------------------------------------------------------


def _inline_sample(limit: int = 180) -> pd.DataFrame:
    """Deterministic fallback sample when no raw behaviour table exists yet."""
    rng = np.random.default_rng(0)
    start = pd.Timestamp("2026-01-01T09:00:00Z")
    applications = ["Visual Studio Code", "Google Chrome", "Terminal"]
    rows = []
    for index in range(limit):
        active = (index % 40) < 26  # typing bursts with idle gaps
        rows.append(
            {
                "id": f"sample-{index}",
                "session_id": "sample-session",
                "keyboard_count": int(rng.integers(1, 6)) if active else 0,
                "mouse_distance": round(float(rng.uniform(2, 45)) if active else 0.0, 3),
                "mouse_clicks": int(rng.integers(0, 3)) if active else 0,
                "idle_time": round(float(rng.uniform(0, 5)), 3),
                "active_application": applications[(index // 45) % len(applications)],
                "created_at": (start + pd.Timedelta(seconds=index)).isoformat(),
            }
        )
    return pd.DataFrame(rows)


def sample_events(source: str | None = None, limit: int = 300) -> tuple[str, str, str]:
    """Return ``(csv_text, filename, origin)`` for a minimal sample upload."""
    candidates: list[tuple[str, Path]] = []
    names = [source] if source in SOURCES else []
    names += [name for name in SOURCES if name not in names]
    for name in names:
        raw_dir = SOURCES[name].get("raw_dir") or RAW_DIR
        candidates.append((name, Path(raw_dir) / "behavior_logs.csv"))

    for origin, path in candidates:
        if path.exists():
            frame = pd.read_csv(path).head(limit)
            return frame.to_csv(index=False), f"sample_session_events_{origin}.csv", origin

    return _inline_sample(limit).to_csv(index=False), "sample_session_events.csv", "inline"
