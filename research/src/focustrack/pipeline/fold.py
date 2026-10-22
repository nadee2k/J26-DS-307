"""Per-fold representation pipeline (proposal 3.8).

Everything that learns from data — the scaler, the HMM, state labels, medians
for imputation — is fitted on the training participants of that fold only. The
held-out participant is transformed with those fitted objects.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from focustrack.config import ALL_TASKS, Config
from focustrack.context.encode import _slug, encode_context
from focustrack.states.hmm import HMMStateModel
from focustrack.states.profile import interruption_states, label_states, state_sequence
from focustrack.states.sequences import build_sequences
from focustrack.transitions.build import attach_transition_features

AGGREGATED = ("typing_rate", "idle_ratio", "mouse_speed_px_s", "switch_rate")
CONDITIONAL = ("inter_key_cv", "backspace_ratio")
TRANSITIONS = (
    "is_interruption",
    "state_dwell",
    "state_changes_5min",
    "time_since_interruption",
    "interruption_censored",
    "recovery_epochs",
    "recovered",
)


@dataclass
class FoldRepresentation:
    train: pd.DataFrame
    test: pd.DataFrame
    info: dict


def _enrich_epochs(
    epochs: pd.DataFrame,
    meta: pd.DataFrame,
    states: np.ndarray,
    labels: list[str],
    interruptions: list[int],
    cfg: Config,
) -> pd.DataFrame:
    sequence = state_sequence(meta, states, labels)
    sequence = sequence.merge(
        epochs[["session_id", "participant_id", "epoch_index", "study_mode", "typing_rate"]],
        on=["session_id", "participant_id", "epoch_index"],
        how="left",
        validate="one_to_one",
    )
    screen_mode = sequence["study_mode"].eq("screen")
    screen_interruption = sequence["state"].isin(interruptions)
    non_screen_interruption = sequence["state_label"].eq("Frequent switching") | (
        sequence["typing_rate"] >= cfg.min_keys_for_rhythm
    )
    sequence["interruption"] = np.where(
        screen_mode, screen_interruption, non_screen_interruption
    ).astype(int)
    sequence = attach_transition_features(
        sequence,
        interruption_states=interruptions,
        recovery_epochs=cfg.recovery_epochs,
        interruption_mask="interruption",
    )
    columns = ["state", "state_label", *TRANSITIONS]
    return epochs.merge(
        sequence[["session_id", "participant_id", "epoch_index", *columns]],
        on=["session_id", "participant_id", "epoch_index"],
        how="left",
        validate="one_to_one",
    )


def enrich_fold(
    train_epochs: pd.DataFrame,
    test_epochs: pd.DataFrame,
    cfg: Config,
    n_states: int,
    seed: int = 42,
) -> FoldRepresentation:
    """Fit the HMM on training epochs and decode both sides of the fold."""
    X_train, lengths_train, meta_train = build_sequences(train_epochs, list(cfg.state_features))
    X_test, lengths_test, meta_test = build_sequences(test_epochs, list(cfg.state_features))

    model = HMMStateModel(
        n_states=n_states,
        feature_names=list(cfg.state_features),
        covariance_type=str(cfg.states.get("covariance_type", "diag")),
        seed=seed,
        n_iter=int(cfg.states.get("n_iter", 200)),
        tol=float(cfg.states.get("tol", 1e-4)),
    ).fit(X_train, lengths_train)

    states_train = model.predict(X_train, lengths_train)
    states_test = model.predict(X_test, lengths_test)
    profiles = model.state_means(X_train, states_train)
    labels = label_states(profiles)
    interruptions = interruption_states(labels)

    train = _enrich_epochs(train_epochs, meta_train, states_train, labels, interruptions, cfg)
    test = _enrich_epochs(test_epochs, meta_test, states_test, labels, interruptions, cfg)
    info = {
        "state_labels": labels,
        "interruption_states": interruptions,
        "state_share": profiles["share"].round(4).tolist(),
        "converged": bool(model.converged),
        "bic": float(model.bic(X_train, lengths_train)),
    }
    return FoldRepresentation(train=train, test=test, info=info)


def _state_one_hot(frame: pd.DataFrame, n_states: int) -> pd.DataFrame:
    for state in range(1, n_states):
        frame[f"state_{state}"] = (frame["state"] == state).astype(int)
    return frame


def _context_columns(tasks: list[str], reference_task: str, n_states: int, states: bool) -> list[str]:
    columns = ["is_screen"]
    columns += [f"task_{_slug(task)}" for task in tasks if task != reference_task]
    columns += ["screen_x_typing", "screen_x_idle", "screen_x_switch"]
    if states:
        for state in range(1, n_states):
            columns.append(f"state_{state}_x_screen")
            columns += [
                f"state_{state}_x_task_{_slug(task)}"
                for task in tasks
                if task != reference_task
            ]
    return columns


def build_representation(
    train: pd.DataFrame,
    test: pd.DataFrame,
    cfg: Config,
    n_states: int,
    variant: dict[str, bool],
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, list[str]]:
    """Build aligned, imputed design matrices for one representation variant."""
    if "focus_label" not in train.columns or "focus_label" not in test.columns:
        raise ValueError("both sides of the fold need focus_label before building X")

    tasks = list(ALL_TASKS)
    reference_task = str(cfg.context.get("reference_task", tasks[0]))

    train = train.copy()
    test = test.copy()
    if variant.get("states"):
        train = _state_one_hot(train, n_states)
        test = _state_one_hot(test, n_states)

    if variant.get("context"):
        state_ids = list(range(n_states)) if variant.get("states") else []
        train = encode_context(
            train, cfg, n_states=n_states, state_ids=state_ids, tasks=tasks
        )
        test = encode_context(
            test, cfg, n_states=n_states, state_ids=state_ids, tasks=tasks
        )

    features: list[str] = list(AGGREGATED)

    if variant.get("temporal", False):
        for column in CONDITIONAL:
            if column in train.columns and train[column].notna().any():
                features.append(column)
                flag = f"is_missing_{column}"
                if flag in train.columns:
                    features.append(flag)

    if variant.get("states"):
        features += [f"state_{state}" for state in range(1, n_states)]

    if variant.get("transitions"):
        features += [column for column in TRANSITIONS if column in train.columns]
        train["is_missing_recovery_epochs"] = train["recovery_epochs"].isna().astype(int)
        test["is_missing_recovery_epochs"] = test["recovery_epochs"].isna().astype(int)
        features.append("is_missing_recovery_epochs")

    if variant.get("context"):
        features += _context_columns(tasks, reference_task, n_states, bool(variant.get("states")))

    features = [column for column in dict.fromkeys(features) if column in train.columns and column in test.columns]
    for column in features:
        if column not in test.columns:
            test[column] = np.nan

    # drop features with no training values or no training variance
    keep: list[str] = []
    for column in features:
        values = pd.to_numeric(train[column], errors="coerce")
        if values.notna().any() and values.nunique(dropna=True) > 1:
            keep.append(column)
    features = keep

    medians: dict[str, float] = {}
    for column in features:
        train_values = pd.to_numeric(train[column], errors="coerce")
        median = float(train_values.median())
        medians[column] = median if np.isfinite(median) else 0.0
        train[column] = train_values.fillna(medians[column])
        test[column] = pd.to_numeric(test[column], errors="coerce").fillna(medians[column])

    X_train = train[features].to_numpy(dtype=float)
    X_test = test[features].to_numpy(dtype=float)
    y_train = train["focus_label"].to_numpy(dtype=int)
    y_test = test["focus_label"].to_numpy(dtype=int)
    return X_train, X_test, y_train, y_test, features
