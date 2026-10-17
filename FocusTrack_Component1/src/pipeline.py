"""End-to-end pipeline for FocusTrack Component 1.

Behavioural logs -> cleaning -> synchronisation -> windowing -> features ->
interaction states -> state transitions -> context-aware representation ->
sequences -> HMM analysis -> session dataset -> baseline / proposed / ablation
experiments -> statistical analysis.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
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
    RANDOM_STATE,
    RESULTS_DIR,
    SEQUENCES_DIR,
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
from src.evaluation.sequential_experiments import (
    evaluate_hmm_augmentation,
    evaluate_hmm_state_representation,
)
from src.evaluation.statistics import (
    compare_representations,
    leave_one_participant_out_predictions,
    metric_by_group,
    summarise_variation,
)
from src.features.feature_builder import build_window_features
from src.integration.export import (
    INTEGRATION_SCHEMA_VERSION,
    SESSION_OUTPUT_SCHEMA,
    WINDOW_OUTPUT_SCHEMA,
    build_outputs,
    save_outputs,
    validate_output,
)
from src.models.dataset import build_session_dataset, select_features
from src.models.sequential import (
    fit_discrete_hmm,
    session_hmm_features,
    state_sequences_by_session,
)
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

PRIMARY_MODEL = "random_forest"
DEFAULT_HMM_HIDDEN = 3


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


def _hmm_analysis(
    features: pd.DataFrame,
    n_states: int,
    n_hidden: int,
) -> tuple[object | None, pd.DataFrame, pd.DataFrame]:
    """Descriptive HMM over the full dataset (analysis only, never model input)."""
    sequences = state_sequences_by_session(features)
    if not sequences:
        return None, pd.DataFrame(), pd.DataFrame()
    model = fit_discrete_hmm(
        list(sequences.values()),
        n_hidden=max(2, min(n_hidden, max(n_states, 2))),
        n_symbols=n_states,
        seed=RANDOM_STATE,
    )
    session_features = session_hmm_features(sequences, model)
    transitions = model.transition_frame().reset_index(names="from_hidden")
    return model, session_features, transitions


def run_pipeline(
    raw: dict[str, pd.DataFrame] | None = None,
    *,
    window_seconds: int = DEFAULT_WINDOW_SECONDS,
    n_states: int = DEFAULT_N_STATES,
    state_method: str = DEFAULT_STATE_METHOD,
    n_hidden: int = DEFAULT_HMM_HIDDEN,
    save: bool = True,
    run_ml: bool = True,
    run_hmm: bool = True,
    artifacts_root: Path | None = None,
) -> dict:
    """Execute the full component pipeline and optionally persist artifacts.

    ``artifacts_root`` redirects every written artifact under one directory
    (``processed/``, ``features/``, ``sequences/``, ``results/``, ``models/``),
    which lets several data sources keep their results side by side. ``None``
    keeps the default layout under ``data/``.
    """
    started = time.monotonic()
    ensure_data_dirs()
    raw = raw if raw is not None else load_raw()
    prepared = prepare_features(
        raw, window_seconds=window_seconds, n_states=n_states, state_method=state_method
    )
    features = prepared["features"]

    sequences = build_sequences(features)
    sequence_map = state_sequences_by_session(features)
    dataset, feature_groups = build_session_dataset(features, prepared["tables"]["concentration_logs"])
    proposed_columns = select_features(
        feature_groups, ["baseline", "temporal", "state", "transition", "context"]
    )

    state_profiles = describe_states(features)
    quality = cluster_quality(features)
    transition_probs = transition_probabilities(features)
    transitions_by_context = transition_probabilities(features, by="context")
    session_transitions = session_transition_summary(features)
    context_analysis = context_effect_analysis(features)
    context_agreement = context_state_agreement(features)
    context_distribution = context_state_distribution(features)

    hmm_model, hmm_session_features_frame, hmm_transitions = _hmm_analysis(
        features, n_states=max(int(pd.to_numeric(features.get("interaction_state"), errors="coerce").max()) + 1, 2)
        if "interaction_state" in features.columns
        else max(n_states, 2),
        n_hidden=n_hidden,
    )

    results = pd.DataFrame()
    summary = pd.DataFrame()
    hmm_results = pd.DataFrame()
    state_results = pd.DataFrame()
    statistics = pd.DataFrame()
    variation = pd.DataFrame()
    participant_variation = pd.DataFrame()
    context_variation = pd.DataFrame()
    predictions = pd.DataFrame()

    if run_ml and not dataset.empty:
        results = run_experiments(dataset, feature_groups)
        summary = summarise(results)
        if proposed_columns and sequence_map and run_hmm:
            hmm_results = evaluate_hmm_augmentation(
                dataset, sequence_map, proposed_columns, n_hidden=n_hidden
            )
            state_results = evaluate_hmm_state_representation(
                dataset, features, feature_groups, sequence_map, n_hidden=n_hidden
            )
        statistics = compare_representations(results)
        predictions = leave_one_participant_out_predictions(
            dataset, proposed_columns, model_name=PRIMARY_MODEL
        )
        if not predictions.empty:
            participant_variation = metric_by_group(predictions, "participant_id")
            context_variation = metric_by_group(predictions, "context")
            variation = pd.DataFrame(
                [
                    {"group": "participant", **summarise_variation(participant_variation)},
                    {"group": "context", **summarise_variation(context_variation)},
                ]
            )

    outputs = build_outputs(features, dataset, predictions=predictions if not predictions.empty else None)
    integration_validation = {
        "schema_version": INTEGRATION_SCHEMA_VERSION,
        "window": validate_output(outputs["behavioural_output_window"], WINDOW_OUTPUT_SCHEMA),
        "session": validate_output(outputs["behavioural_output_session"], SESSION_OUTPUT_SCHEMA),
    }

    bundle = {
        **prepared,
        "sequences": sequences,
        "sequence_map": sequence_map,
        "dataset": dataset,
        "feature_groups": feature_groups,
        "proposed_columns": proposed_columns,
        "state_profiles": state_profiles,
        "cluster_quality": quality,
        "transition_probabilities": transition_probs,
        "transitions_by_context": transitions_by_context,
        "session_transitions": session_transitions,
        "context_analysis": context_analysis,
        "context_agreement": context_agreement,
        "context_distribution": context_distribution,
        "hmm_model": hmm_model,
        "hmm_session_features": hmm_session_features_frame,
        "hmm_transitions": hmm_transitions,
        "hmm_results": hmm_results,
        "hmm_summary": summarise(hmm_results) if not hmm_results.empty else pd.DataFrame(),
        "state_results": state_results,
        "state_summary": summarise(state_results) if not state_results.empty else pd.DataFrame(),
        "predictions": predictions,
        "statistics": statistics,
        "variation": variation,
        "participant_variation": participant_variation,
        "context_variation": context_variation,
        "outputs": outputs,
        "integration_validation": integration_validation,
        "results": results,
        "summary": summary,
    }

    bundle["run_params"] = {
        "window_seconds": window_seconds,
        "n_states": n_states,
        "state_method": state_method,
        "n_hidden": n_hidden,
        "run_ml": run_ml,
        "run_hmm": run_hmm,
        "events": int(len(prepared["events"])),
        "windows": int(len(features)),
        "sessions": int(len(dataset)),
        "labelled_sessions": int(dataset["concentration_label"].notna().sum())
        if "concentration_label" in dataset.columns
        else 0,
    }
    bundle["duration_seconds"] = round(time.monotonic() - started, 1)

    if save:
        bundle["artifacts"] = save_artifacts(bundle, artifacts_root)
    return bundle


def artifact_dirs(root: Path | None = None) -> dict[str, Path]:
    """Directory layout for one data source's artifacts."""
    if root is None:
        return {
            "processed": PROCESSED_DIR,
            "features": FEATURES_DIR,
            "sequences": SEQUENCES_DIR,
            "results": RESULTS_DIR,
            "models": MODELS_DIR,
        }
    root = Path(root)
    return {name: root / name for name in ("processed", "features", "sequences", "results", "models")}


def save_artifacts(bundle: dict, root: Path | None = None) -> dict[str, Path]:
    dirs = artifact_dirs(root)
    for directory in dirs.values():
        directory.mkdir(parents=True, exist_ok=True)
    results_dir = dirs["results"]
    written: dict[str, Path] = {}

    written["events"] = _write_csv(bundle["events"], dirs["processed"] / "events.csv")
    written["features"] = _write_csv(bundle["features"], dirs["features"] / "features.csv")
    written["state_profiles"] = _write_csv(bundle["state_profiles"], dirs["features"] / "state_profiles.csv")
    written["session_dataset"] = _write_csv(bundle["dataset"], dirs["features"] / "session_dataset.csv")
    written["transition_probabilities"] = _write_csv(
        bundle["transition_probabilities"], results_dir / "transition_probabilities.csv"
    )
    written["transitions_by_context"] = _write_csv(
        bundle["transitions_by_context"], results_dir / "transitions_by_context.csv"
    )
    written["session_transitions"] = _write_csv(
        bundle["session_transitions"], results_dir / "session_transitions.csv"
    )
    written["context_analysis"] = _write_csv(
        bundle["context_analysis"], results_dir / "context_effect_analysis.csv"
    )
    written["context_agreement"] = _write_csv(
        bundle["context_agreement"], results_dir / "context_state_agreement.csv"
    )
    written["hmm_session_features"] = _write_csv(
        bundle["hmm_session_features"], results_dir / "hmm_session_features.csv"
    )
    written["hmm_transitions"] = _write_csv(
        bundle["hmm_transitions"], results_dir / "hmm_hidden_transitions.csv"
    )

    written.update(save_sequences(bundle["sequences"], target=dirs["sequences"]))

    if bundle.get("state_model") is not None:
        joblib.dump(bundle["state_model"], dirs["models"] / "state_model.joblib")
        if bundle.get("scaler") is not None:
            joblib.dump(bundle["scaler"], dirs["models"] / "state_scaler.joblib")
    if bundle.get("hmm_model") is not None:
        joblib.dump(bundle["hmm_model"], dirs["models"] / "hmm_model.joblib")

    with (results_dir / "state_quality.json").open("w", encoding="utf-8") as handle:
        json.dump(bundle["cluster_quality"], handle, indent=2)
    written["state_quality"] = results_dir / "state_quality.json"

    if not bundle["results"].empty:
        written["experiments"] = save_results(bundle["results"], "experiments", results_dir)
        written["experiment_summary"] = save_results(bundle["summary"], "experiment_summary", results_dir)
    if not bundle["hmm_results"].empty:
        written["sequential_experiments"] = save_results(
            bundle["hmm_results"], "sequential_experiments", results_dir
        )
        written["sequential_summary"] = save_results(
            bundle["hmm_summary"], "sequential_summary", results_dir
        )
    if not bundle["state_results"].empty:
        written["state_representation_experiments"] = save_results(
            bundle["state_results"], "state_representation_experiments", results_dir
        )
        written["state_representation_summary"] = save_results(
            bundle["state_summary"], "state_representation_summary", results_dir
        )
    if not bundle["statistics"].empty:
        written["statistics"] = save_results(
            bundle["statistics"], "statistics_comparison", results_dir
        )
    if not bundle["variation"].empty:
        written["variation"] = save_results(bundle["variation"], "statistics_variation", results_dir)
        written["participant_variation"] = save_results(
            bundle["participant_variation"], "participant_variation", results_dir
        )
        written["context_variation"] = save_results(
            bundle["context_variation"], "context_variation", results_dir
        )

    integration = save_outputs(bundle["outputs"], target=results_dir / "integration")
    written.update(integration)
    with (results_dir / "integration_validation.json").open("w", encoding="utf-8") as handle:
        json.dump(bundle["integration_validation"], handle, indent=2)
    written["integration_validation"] = results_dir / "integration_validation.json"

    manifest = {
        "finished_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "duration_seconds": bundle.get("duration_seconds"),
        "params": bundle.get("run_params", {}),
        "cluster_quality": bundle.get("cluster_quality"),
        "integration_schema_version": INTEGRATION_SCHEMA_VERSION,
    }
    with (results_dir / "run_manifest.json").open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
    return written


def _write_csv(frame: pd.DataFrame, path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(path, index=False)
    return path
