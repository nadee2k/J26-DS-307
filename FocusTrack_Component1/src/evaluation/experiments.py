"""Experimental comparison: baseline vs proposed vs ablations (SO6).

Runs every representation through every candidate model under both validation
schemes and returns a tidy results table. This is the empirical core of the
component: it tests whether the context-aware state-and-transition
representation adds predictive information beyond conventional aggregated
features.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from src.config import RANDOM_STATE, RESULTS_DIR
from src.evaluation.metrics import compute_metrics
from src.evaluation.splits import leave_one_context_out, participant_folds
from src.models.dataset import LABEL_COL, select_features
from src.models.train import available_models, fit_predict

# Representation name -> representation groups included.
REPRESENTATIONS: dict[str, list[str]] = {
    "baseline": ["baseline"],
    "proposed": ["baseline", "temporal", "state", "transition", "context"],
    "ablation_no_context": ["baseline", "temporal", "state", "transition"],
    "ablation_no_transition": ["baseline", "temporal", "state", "context"],
    "ablation_no_state": ["baseline", "temporal", "transition", "context"],
    "ablation_no_temporal": ["baseline", "state", "transition", "context"],
}

SPLIT_SCHEMES = ("participant", "cross_context")


def _folds(
    dataset: pd.DataFrame,
    label_col: str,
    split_scheme: str,
    n_splits: int,
    seed: int,
) -> list[tuple[str, np.ndarray, np.ndarray]]:
    if split_scheme == "cross_context" and "context" in dataset.columns:
        return leave_one_context_out(dataset["context"])
    folds = participant_folds(dataset["participant_id"], dataset[label_col], n_splits=n_splits, seed=seed)
    return [(f"fold{index}", train, test) for index, (train, test) in enumerate(folds)]


def evaluate_representation(
    dataset: pd.DataFrame,
    columns: list[str],
    *,
    representation: str,
    model_names: list[str],
    split_scheme: str,
    label_col: str = LABEL_COL,
    n_splits: int = 5,
    seed: int = RANDOM_STATE,
) -> pd.DataFrame:
    """Cross-validate one representation and return per-fold + pooled metrics."""
    if dataset.empty or not columns or label_col not in dataset.columns:
        return pd.DataFrame()
    columns = [c for c in columns if c in dataset.columns]
    if not columns:
        return pd.DataFrame()

    X = dataset[columns].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    y = dataset[label_col].reset_index(drop=True)
    folds = _folds(dataset.reset_index(drop=True), label_col, split_scheme, n_splits, seed)
    if not folds:
        return pd.DataFrame()

    rows: list[dict] = []
    for model_name in model_names:
        pooled_true: list = []
        pooled_pred: list = []
        for fold_name, train_idx, test_idx in folds:
            if len(train_idx) < 2 or len(test_idx) < 1:
                continue
            try:
                predictions, probabilities = fit_predict(
                    model_name,
                    X.iloc[train_idx],
                    y.iloc[train_idx],
                    X.iloc[test_idx],
                    seed=seed,
                )
            except Exception as exc:  # keep the experiment running
                rows.append(
                    {
                        "representation": representation,
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
                    "representation": representation,
                    "model": model_name,
                    "split": split_scheme,
                    "fold": fold_name,
                    "n_train": len(train_idx),
                    "n_test": len(test_idx),
                }
            )
            rows.append(metrics)
            pooled_true.extend(y.iloc[test_idx].tolist())
            pooled_pred.extend(predictions.tolist())

        if pooled_true:
            pooled = compute_metrics(pooled_true, pooled_pred, None)
            pooled.update(
                {
                    "representation": representation,
                    "model": model_name,
                    "split": split_scheme,
                    "fold": "pooled",
                    "n_train": np.nan,
                    "n_test": len(pooled_true),
                }
            )
            rows.append(pooled)

    return pd.DataFrame(rows)


def run_experiments(
    dataset: pd.DataFrame,
    feature_groups: dict[str, list[str]],
    *,
    label_col: str = LABEL_COL,
    model_names: list[str] | None = None,
    split_schemes: tuple[str, ...] = SPLIT_SCHEMES,
    n_splits: int = 5,
    seed: int = RANDOM_STATE,
) -> pd.DataFrame:
    """Run the full baseline / proposed / ablation comparison."""
    model_names = model_names or available_models()
    frames = []
    for representation, groups in REPRESENTATIONS.items():
        columns = select_features(feature_groups, groups)
        for split_scheme in split_schemes:
            frame = evaluate_representation(
                dataset,
                columns,
                representation=representation,
                model_names=model_names,
                split_scheme=split_scheme,
                label_col=label_col,
                n_splits=n_splits,
                seed=seed,
            )
            if not frame.empty:
                frames.append(frame)
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def summarise(results: pd.DataFrame) -> pd.DataFrame:
    """Aggregate per-fold metrics into mean/standard deviation per configuration."""
    if results.empty:
        return pd.DataFrame()
    folds = results[results["fold"] != "pooled"].copy()
    if folds.empty:
        return pd.DataFrame()
    index = ["representation", "model", "split"]
    summary = folds.groupby(index).agg(
        n_folds=("fold", "nunique"),
        macro_f1_mean=("macro_f1", "mean"),
        macro_f1_std=("macro_f1", "std"),
        balanced_accuracy_mean=("balanced_accuracy", "mean"),
        accuracy_mean=("accuracy", "mean"),
        recall_macro_mean=("recall_macro", "mean"),
        precision_macro_mean=("precision_macro", "mean"),
        roc_auc_mean=("roc_auc", "mean"),
    )
    return summary.reset_index().sort_values(["split", "macro_f1_mean"], ascending=[True, False])


def save_results(results: pd.DataFrame, name: str = "experiments", target: Path | None = None) -> Path:
    directory = Path(target or RESULTS_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{name}.csv"
    results.to_csv(path, index=False)
    return path
