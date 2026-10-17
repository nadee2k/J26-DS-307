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
from src.evaluation.experiments import make_folds
from src.evaluation.metrics import compute_metrics
from src.models.dataset import LABEL_COL
from src.models.sequential import (
    fit_discrete_hmm,
    sequence_feature_columns,
    session_hmm_features,
)
from src.models.train import available_models, fit_predict

REPRESENTATIONS = ("proposed", "proposed_hmm")


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
