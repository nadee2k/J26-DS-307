"""End-to-end pipeline for FocusTrack Component 1.

Behavioural logs -> cleaning -> synchronisation -> windowing -> features ->
interaction states -> state transitions -> context-aware representation ->
session dataset -> baseline / proposed / ablation experiments.
"""

from __future__ import annotations

import json
from pathlib import Path

import joblib
import pandas as pd

from src.config import (
    DEFAULT_N_STATES,
    DEFAULT_STATE_METHOD,
    DEFAULT_WINDOW_SECONDS,
    FEATURES_DIR,
    MODELS_DIR,
    PROCESSED_DIR,
    RESULTS_DIR,
    ensure_data_dirs,
)
from src.context.context_model import (
    add_context_features,
    context_effect_analysis,
    context_state_agreement,
    context_state_distribution,
)
from src.database.data_loader import load_raw
from src.evaluation.experiments import run_experiments, save_results, summarise
from src.features.feature_builder import build_window_features
from src.models.dataset import build_session_dataset
from src.preprocessing.cleaner import (
    clean_behavior_logs,
    clean_concentration_logs,
    clean_sessions,
)
from src.preprocessing.sequence_builder import build_sequences, save_sequences
from src.preprocessing.synchronizer import synchronize_events
from src.preprocessing.windowing import create_time_windows
from src.states.state_analysis import describe_states
from src.states.state_discovery import discover_states
from src.states.state_validation import cluster_quality
from src.transitions.transition_model import (
    add_state_transitions,
    session_transition_summary,
    transition_probabilities,
)


def _clean_tables(raw: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    return {
        "students": raw.get("students", pd.DataFrame()),
        "study_sessions": clean_sessions(raw.get("study_sessions", pd.DataFrame())),
        "behavior_logs": clean_behavior_logs(raw.get("behavior_logs", pd.DataFrame())),
        "concentration_logs": clean_concentration_logs(raw.get("concentration_logs", pd.DataFrame())),
    }


def prepare_features(
    raw: dict[str, pd.DataFrame],
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
    n_states: int = DEFAULT_N_STATES,
    state_method: str = DEFAULT_STATE_METHOD,
) -> dict:
    """Run every stage up to and including the context-aware representation."""
    tables = _clean_tables(raw)

    events = synchronize_events(tables["behavior_logs"], tables["study_sessions"], tables["students"])
    windows = create_time_windows(events, window_seconds)
    features = build_window_features(windows, tables["concentration_logs"])

    features, state_model, scaler, state_cols = discover_states(
        features, n_states=n_states, method=state_method
    )
    features = add_state_transitions(features)
    features = add_context_features(features, n_states=n_states)

    return {
        "tables": tables,
        "events": events,
        "windows": windows,
        "features": features,
        "state_model": state_model,
        "scaler": scaler,
        "state_feature_cols": state_cols,
    }


def run_pipeline(
    raw: dict[str, pd.DataFrame] | None = None,
    *,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
    n_states: int = DEFAULT_N_STATES,
    state_method: str = DEFAULT_STATE_METHOD,
    save: bool = True,
    run_ml: bool = True,
) -> dict:
    """Execute the full component pipeline and optionally persist artifacts."""
    ensure_data_dirs()
    raw = raw if raw is not None else load_raw()
    prepared = prepare_features(
        raw, window_seconds=window_seconds, n_states=n_states, state_method=state_method
    )
    features = prepared["features"]

    sequences = build_sequences(features)
    dataset, feature_groups = build_session_dataset(features, prepared["tables"]["concentration_logs"])

    state_profiles = describe_states(features)
    quality = cluster_quality(features)
    transition_probs = transition_probabilities(features)
    transitions_by_context = transition_probabilities(features, by="context")
    session_transitions = session_transition_summary(features)
    context_analysis = context_effect_analysis(features)
    context_agreement = context_state_agreement(features)
    context_distribution = context_state_distribution(features)

    results = pd.DataFrame()
    summary = pd.DataFrame()
    if run_ml and not dataset.empty:
        results = run_experiments(dataset, feature_groups)
        summary = summarise(results)

    bundle = {
        **prepared,
        "sequences": sequences,
        "dataset": dataset,
        "feature_groups": feature_groups,
        "state_profiles": state_profiles,
        "cluster_quality": quality,
        "transition_probabilities": transition_probs,
        "transitions_by_context": transitions_by_context,
        "session_transitions": session_transitions,
        "context_analysis": context_analysis,
        "context_agreement": context_agreement,
        "context_distribution": context_distribution,
        "results": results,
        "summary": summary,
    }

    if save:
        bundle["artifacts"] = save_artifacts(bundle)
    return bundle


def save_artifacts(bundle: dict) -> dict[str, Path]:
    written: dict[str, Path] = {}

    written["events"] = _write_csv(bundle["events"], PROCESSED_DIR / "events.csv")
    written["features"] = _write_csv(bundle["features"], FEATURES_DIR / "features.csv")
    written["state_profiles"] = _write_csv(bundle["state_profiles"], FEATURES_DIR / "state_profiles.csv")
    written["session_dataset"] = _write_csv(bundle["dataset"], FEATURES_DIR / "session_dataset.csv")
    written["transition_probabilities"] = _write_csv(
        bundle["transition_probabilities"], RESULTS_DIR / "transition_probabilities.csv"
    )
    written["transitions_by_context"] = _write_csv(
        bundle["transitions_by_context"], RESULTS_DIR / "transitions_by_context.csv"
    )
    written["session_transitions"] = _write_csv(
        bundle["session_transitions"], RESULTS_DIR / "session_transitions.csv"
    )
    written["context_analysis"] = _write_csv(
        bundle["context_analysis"], RESULTS_DIR / "context_effect_analysis.csv"
    )
    written["context_agreement"] = _write_csv(
        bundle["context_agreement"], RESULTS_DIR / "context_state_agreement.csv"
    )

    written.update(save_sequences(bundle["sequences"]))

    if bundle.get("state_model") is not None:
        joblib.dump(bundle["state_model"], MODELS_DIR / "state_model.joblib")
        if bundle.get("scaler") is not None:
            joblib.dump(bundle["scaler"], MODELS_DIR / "state_scaler.joblib")

    with (RESULTS_DIR / "state_quality.json").open("w", encoding="utf-8") as handle:
        json.dump(bundle["cluster_quality"], handle, indent=2)

    if not bundle["results"].empty:
        written["experiments"] = save_results(bundle["results"], "experiments")
        written["experiment_summary"] = save_results(bundle["summary"], "experiment_summary")
    return written


def _write_csv(frame: pd.DataFrame, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)
    return path
