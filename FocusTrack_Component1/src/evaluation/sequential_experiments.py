"""Fold-safe evaluation of HMM-derived sequence features (proposal section 3.5).

Tests whether adding hidden-Markov sequence information to the context-aware
representation improves concentration classification beyond the state and
transition features alone.

The HMM is refitted inside every cross-validation fold on the training
sessions' state sequences only; test sessions are then scored with that model.
This is essential -- fitting the HMM on the whole dataset first and then
cross-validating would leak information across the split.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import RANDOM_STATE
from src.context.context_model import add_context_features
from src.evaluation.experiments import make_folds
from src.evaluation.metrics import compute_metrics
from src.models.dataset import LABEL_COL, build_session_dataset, select_features
from src.models.sequential import (
    decode_states_for_features,
    fit_discrete_hmm,
    sequence_feature_columns,
    session_hmm_features,
)
from src.models.train import available_models, fit_predict
from src.transitions.transition_model import add_state_transitions

REPRESENTATIONS = ("proposed", "proposed_hmm")

STATE_REPRESENTATIONS = ("kmeans_states", "hmm_states")


def _hmm_matrix(
    sequences: dict[tuple, np.ndarray],
    model,
    keys: list[tuple],
    n_hidden: int,
) -> pd.DataFrame:
    columns = sequence_feature_columns(n_hidden)
    frame = session_hmm_features(sequences, model)
    if frame.empty:
        return pd.DataFrame(np.zeros((len(keys), len(columns))), columns=columns)
    frame = frame.set_index(["participant_id", "session_id"])
    aligned = frame.reindex(keys)
    return aligned[columns].fillna(0.0).reset_index(drop=True)


def evaluate_hmm_augmentation(
    dataset: pd.DataFrame,
    sequences: dict[tuple, np.ndarray],
    base_columns: list[str],
    *,
    label_col: str = LABEL_COL,
    model_names: list[str] | None = None,
    n_hidden: int = 3,
    hmm_restarts: int = 3,
    hmm_iter: int = 60,
    split_scheme: str = "participant",
    n_splits: int = 5,
    seed: int = RANDOM_STATE,
) -> pd.DataFrame:
    """Compare the base representation with and without HMM sequence features."""
    if dataset.empty or label_col not in dataset.columns or not sequences:
        return pd.DataFrame()

    model_names = model_names or available_models()
    data = dataset.reset_index(drop=True)
    base_columns = [c for c in base_columns if c in data.columns]
    if not base_columns:
        return pd.DataFrame()

    keys = list(zip(data["participant_id"], data["session_id"]))
    y = data[label_col].reset_index(drop=True)
    X_base = data[base_columns].apply(pd.to_numeric, errors="coerce").fillna(0.0)

    folds = make_folds(data, label_col, split_scheme, n_splits, seed)
    if not folds:
        return pd.DataFrame()

    n_symbols = max((int(obs.max()) for obs in sequences.values() if len(obs) > 0), default=0) + 1

    # Pooled predictions per (model, representation) for whole-experiment metrics.
    pooled: dict[tuple[str, str], tuple[list, list]] = {
        (model_name, name): ([], []) for model_name in model_names for name in REPRESENTATIONS
    }
    rows: list[dict] = []

    for fold_name, train_idx, test_idx in folds:
        train_keys = [keys[i] for i in train_idx]
        train_sequences = [
            sequences[key] for key in train_keys if key in sequences and len(sequences[key]) > 0
        ]
        if not train_sequences:
            continue

        # Fit the HMM once per fold; reuse it for every candidate model.
        hmm_model = fit_discrete_hmm(
            train_sequences,
            n_hidden=n_hidden,
            n_symbols=n_symbols,
            n_iter=hmm_iter,
            seed=seed,
            n_restarts=hmm_restarts,
        )
        fold_keys = set(train_keys) | {keys[i] for i in test_idx}
        fold_sequences = {key: sequences[key] for key in fold_keys if key in sequences}
        X_hmm = _hmm_matrix(fold_sequences, hmm_model, keys, n_hidden)
        X_full = pd.concat([X_base, X_hmm], axis=1)

        for model_name in model_names:
            for name, X in (("proposed", X_base), ("proposed_hmm", X_full)):
                try:
                    predictions, probabilities = fit_predict(
                        model_name, X.iloc[train_idx], y.iloc[train_idx], X.iloc[test_idx], seed=seed
                    )
                except Exception as exc:
                    rows.append(
                        {
                            "representation": name,
                            "model": model_name,
                            "split": split_scheme,
                            "fold": fold_name,
                            "error": str(exc),
                        }
                    )
                    continue
                metrics = compute_metrics(y.iloc[test_idx], predictions, probabilities)
                metrics.update(
                    {
                        "representation": name,
                        "model": model_name,
                        "split": split_scheme,
                        "fold": fold_name,
                        "n_train": len(train_idx),
                        "n_test": len(test_idx),
                    }
                )
                rows.append(metrics)
                pooled[(model_name, name)][0].extend(y.iloc[test_idx].tolist())
                pooled[(model_name, name)][1].extend(predictions.tolist())

    for (model_name, name), (true_values, predictions) in pooled.items():
        if not true_values:
            continue
        pooled_metrics = compute_metrics(true_values, predictions, None)
        pooled_metrics.update(
            {
                "representation": name,
                "model": model_name,
                "split": split_scheme,
                "fold": "pooled",
                "n_train": np.nan,
                "n_test": len(true_values),
            }
        )
        rows.append(pooled_metrics)

    return pd.DataFrame(rows)


def evaluate_hmm_state_representation(
    dataset: pd.DataFrame,
    features: pd.DataFrame,
    feature_groups: dict[str, list[str]],
    sequences: dict[tuple, np.ndarray],
    *,
    label_col: str = LABEL_COL,
    model_names: list[str] | None = None,
    n_hidden: int = 3,
    hmm_restarts: int = 3,
    hmm_iter: int = 60,
    split_scheme: str = "participant",
    n_splits: int = 5,
    seed: int = RANDOM_STATE,
) -> pd.DataFrame:
    """Compare KMeans interaction states against HMM-decoded hidden regimes.

    For the ``hmm_states`` representation the HMM is fitted per fold on training
    sessions only; its decoded regimes replace the discovered states, and the
    state / transition / context features are then recomputed from those
    regimes. Everything is derived from the training fold, so no leakage occurs.
    """
    if dataset.empty or label_col not in dataset.columns or not sequences or features.empty:
        return pd.DataFrame()

    model_names = model_names or available_models()
    data = dataset.reset_index(drop=True)
    y = data[label_col].reset_index(drop=True)

    base_cols = [c for c in select_features(feature_groups, ["baseline", "temporal"]) if c in data.columns]
    kmeans_cols = [
        c
        for c in select_features(feature_groups, ["baseline", "temporal", "state", "transition", "context"])
        if c in data.columns
    ]
    if not base_cols or not kmeans_cols:
        return pd.DataFrame()

    X_base = data[base_cols].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    X_kmeans = data[kmeans_cols].apply(pd.to_numeric, errors="coerce").fillna(0.0)

    keys = list(zip(data["participant_id"], data["session_id"]))
    folds = make_folds(data, label_col, split_scheme, n_splits, seed)
    if not folds:
        return pd.DataFrame()

    n_symbols = max((int(obs.max()) for obs in sequences.values() if len(obs) > 0), default=0) + 1

    pooled: dict[tuple[str, str], tuple[list, list]] = {
        (model_name, name): ([], []) for model_name in model_names for name in STATE_REPRESENTATIONS
    }
    rows: list[dict] = []

    for fold_name, train_idx, test_idx in folds:
        train_keys = [keys[i] for i in train_idx]
        train_sequences = [
            sequences[key] for key in train_keys if key in sequences and len(sequences[key]) > 0
        ]
        if not train_sequences:
            continue

        hmm_model = fit_discrete_hmm(
            train_sequences,
            n_hidden=n_hidden,
            n_symbols=n_symbols,
            n_iter=hmm_iter,
            seed=seed,
            n_restarts=hmm_restarts,
        )
        decoded = decode_states_for_features(features, hmm_model, output_col="interaction_state")
        decoded = add_state_transitions(decoded)
        decoded = add_context_features(decoded, n_states=n_hidden)
        ds_hmm, groups_hmm = build_session_dataset(decoded, concentration=None, require_label=False)

        context_cols = [
            c
            for c in select_features(groups_hmm, ["state", "transition", "context"])
            if c in ds_hmm.columns
        ]
        if context_cols:
            block = ds_hmm[["participant_id", "session_id", *context_cols]]
            merged = data[["participant_id", "session_id"]].merge(
                block, on=["participant_id", "session_id"], how="left"
            )
            hmm_block = merged[context_cols].apply(pd.to_numeric, errors="coerce").fillna(0.0)
        else:
            hmm_block = pd.DataFrame(index=data.index)
        X_hmm = pd.concat([X_base.reset_index(drop=True), hmm_block.reset_index(drop=True)], axis=1)

        for model_name in model_names:
            for name, X in (("kmeans_states", X_kmeans), ("hmm_states", X_hmm)):
                try:
                    predictions, probabilities = fit_predict(
                        model_name, X.iloc[train_idx], y.iloc[train_idx], X.iloc[test_idx], seed=seed
                    )
                except Exception as exc:
                    rows.append(
                        {
                            "representation": name,
                            "model": model_name,
                            "split": split_scheme,
                            "fold": fold_name,
                            "error": str(exc),
                        }
                    )
                    continue
                metrics = compute_metrics(y.iloc[test_idx], predictions, probabilities)
                metrics.update(
                    {
                        "representation": name,
                        "model": model_name,
                        "split": split_scheme,
                        "fold": fold_name,
                        "n_train": len(train_idx),
                        "n_test": len(test_idx),
                    }
                )
                rows.append(metrics)
                pooled[(model_name, name)][0].extend(y.iloc[test_idx].tolist())
                pooled[(model_name, name)][1].extend(predictions.tolist())

    for (model_name, name), (true_values, predictions) in pooled.items():
        if not true_values:
            continue
        pooled_metrics = compute_metrics(true_values, predictions, None)
        pooled_metrics.update(
            {
                "representation": name,
                "model": model_name,
                "split": split_scheme,
                "fold": "pooled",
                "n_train": np.nan,
                "n_test": len(true_values),
            }
        )
        rows.append(pooled_metrics)

    return pd.DataFrame(rows)
