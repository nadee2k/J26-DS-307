"""Artifact access for the demo UI.

Two data sources are kept side by side:

* ``real``      -- the Supabase pilot tables, written to the default ``data/`` layout;
* ``synthetic`` -- generated demo data, written under ``data/synthetic/``.

``artifacts_root`` in :mod:`src.pipeline` is what makes that split possible.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from src.config import DATA_DIR, RAW_DIR
from src.pipeline import artifact_dirs

SYNTHETIC_ROOT = DATA_DIR / "synthetic"

SOURCES: dict[str, dict[str, Any]] = {
    "real": {
        "label": "Real pilot data",
        "detail": "Live behaviour logs pulled from Supabase.",
        "root": None,
        "raw_dir": RAW_DIR,
        "synthetic": False,
    },
    "synthetic": {
        "label": "Synthetic demo data",
        "detail": "Generated for demonstration. Results must not be used in the report.",
        "root": SYNTHETIC_ROOT,
        "raw_dir": SYNTHETIC_ROOT / "raw",
        "synthetic": True,
    },
}

# name -> (subdirectory under the source root, filename)
TABLES: dict[str, tuple[str, str]] = {
    "events": ("processed", "events.csv"),
    "features": ("features", "features.csv"),
    "state_profiles": ("features", "state_profiles.csv"),
    "session_dataset": ("features", "session_dataset.csv"),
    "state_sequences": ("sequences", "state_sequences.csv"),
    "window_sequences": ("sequences", "window_sequences.csv"),
    "transition_probabilities": ("results", "transition_probabilities.csv"),
    "transitions_by_context": ("results", "transitions_by_context.csv"),
    "session_transitions": ("results", "session_transitions.csv"),
    "context_analysis": ("results", "context_effect_analysis.csv"),
    "context_agreement": ("results", "context_state_agreement.csv"),
    "hmm_session_features": ("results", "hmm_session_features.csv"),
    "hmm_hidden_transitions": ("results", "hmm_hidden_transitions.csv"),
    "experiments": ("results", "experiments.csv"),
    "experiment_summary": ("results", "experiment_summary.csv"),
    "sequential_experiments": ("results", "sequential_experiments.csv"),
    "sequential_summary": ("results", "sequential_summary.csv"),
    "state_representation_experiments": ("results", "state_representation_experiments.csv"),
    "state_representation_summary": ("results", "state_representation_summary.csv"),
    "statistics_comparison": ("results", "statistics_comparison.csv"),
    "statistics_variation": ("results", "statistics_variation.csv"),
    "participant_variation": ("results", "participant_variation.csv"),
    "context_variation": ("results", "context_variation.csv"),
    "behavioural_output_window": ("results", "integration/behavioural_output_window.csv"),
    "behavioural_output_session": ("results", "integration/behavioural_output_session.csv"),
}

JSON_FILES: dict[str, tuple[str, str]] = {
    "state_quality": ("results", "state_quality.json"),
    "integration_validation": ("results", "integration_validation.json"),
    "run_manifest": ("results", "run_manifest.json"),
}

MAX_ROWS = 5000


def source_info(source: str) -> dict[str, Any]:
    if source not in SOURCES:
        raise KeyError(f"Unknown source: {source}")
    info = dict(SOURCES[source])
    info["id"] = source
    return info


def dirs_for(source: str) -> dict[str, Path]:
    return artifact_dirs(source_info(source)["root"])


def table_path(source: str, name: str) -> Path | None:
    if name not in TABLES:
        return None
    subdir, filename = TABLES[name]
    return dirs_for(source)[subdir] / filename


def _records(frame: pd.DataFrame) -> list[dict]:
    return json.loads(frame.to_json(orient="records", date_format="iso"))


def read_table(
    source: str, name: str, limit: int = 200, offset: int = 0
) -> dict[str, Any]:
    """Return one artifact as JSON records with paging information."""
    path = table_path(source, name)
    if path is None:
        raise KeyError(f"Unknown artifact: {name}")
    if not path.exists():
        return {"columns": [], "rows": [], "total": 0, "exists": False, "path": str(path)}
    try:
        frame = pd.read_csv(path)
    except pd.errors.EmptyDataError:
        # An artifact can exist with no header at all (e.g. an analysis that
        # produced no rows) - still a valid, empty result.
        return {"columns": [], "rows": [], "total": 0, "exists": True, "path": str(path)}
    limit = max(1, min(int(limit), MAX_ROWS))
    offset = max(0, int(offset))
    window = frame.iloc[offset : offset + limit]
    return {
        "columns": [str(c) for c in frame.columns],
        "rows": _records(window),
        "total": int(len(frame)),
        "exists": True,
        "path": str(path),
    }


def read_json(source: str, name: str) -> dict[str, Any]:
    if name not in JSON_FILES:
        raise KeyError(f"Unknown json artifact: {name}")
    subdir, filename = JSON_FILES[name]
    path = dirs_for(source)[subdir] / filename
    if not path.exists():
        return {"exists": False, "data": None}
    with path.open(encoding="utf-8") as handle:
        return {"exists": True, "data": json.load(handle)}


def _count(frame: pd.DataFrame, column: str) -> int:
    return int(frame[column].nunique()) if column in frame.columns and not frame.empty else 0


def overview(source: str) -> dict[str, Any]:
    """Counts a demo audience cares about, plus the parameters of the last run."""
    events = read_table(source, "events", limit=1)
    features = read_table(source, "features", limit=1)
    dataset = read_table(source, "session_dataset", limit=MAX_ROWS)
    quality = read_json(source, "state_quality")
    manifest = read_json(source, "run_manifest")

    events_frame = pd.read_csv(table_path(source, "events")) if events["exists"] else pd.DataFrame()
    features_frame = (
        pd.read_csv(table_path(source, "features")) if features["exists"] else pd.DataFrame()
    )
    dataset_frame = (
        pd.read_csv(table_path(source, "session_dataset")) if dataset["exists"] else pd.DataFrame()
    )

    labelled = 0
    if "concentration_label" in dataset_frame.columns:
        labelled = int(dataset_frame["concentration_label"].notna().sum())

    state_distribution: list[dict] = []
    if "interaction_state" in features_frame.columns:
        counts = features_frame["interaction_state"].value_counts().sort_index()
        state_distribution = [
            {"state": int(state), "windows": int(count)} for state, count in counts.items()
        ]

    context_distribution: list[dict] = []
    if "context" in features_frame.columns:
        counts = features_frame["context"].value_counts()
        context_distribution = [
            {"context": str(context), "windows": int(count)} for context, count in counts.items()
        ]

    return {
        "source": source,
        "label": source_info(source)["label"],
        "detail": source_info(source)["detail"],
        "synthetic": source_info(source)["synthetic"],
        "counts": {
            "participants": _count(events_frame, "participant_id"),
            "sessions": _count(events_frame, "session_id"),
            "events": int(len(events_frame)),
            "windows": int(len(features_frame)),
            "labelled_sessions": labelled,
            "modelled_sessions": int(len(dataset_frame)),
            "states": int(features_frame["interaction_state"].nunique())
            if "interaction_state" in features_frame.columns
            else 0,
            "contexts": _count(features_frame, "context"),
        },
        "state_distribution": state_distribution,
        "context_distribution": context_distribution,
        "cluster_quality": quality["data"] if quality["exists"] else None,
        "run": manifest["data"] if manifest["exists"] else None,
    }


def list_artifacts(source: str) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for name, (subdir, filename) in TABLES.items():
        path = dirs_for(source)[subdir] / filename
        item: dict[str, Any] = {
            "name": name,
            "path": str(path),
            "exists": path.exists(),
            "rows": 0,
        }
        if path.exists():
            item["rows"] = int(sum(1 for _ in path.open(encoding="utf-8"))) - 1
        found.append(item)
    return found
