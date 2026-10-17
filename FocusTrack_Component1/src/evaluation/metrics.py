"""Evaluation metrics (proposal section 3.10). Macro-F1 is the primary metric."""

from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

from src.config import RANDOM_STATE


def compute_metrics(
    y_true: pd.Series,
    y_pred: pd.Series,
    y_proba: np.ndarray | None = None,
) -> dict[str, float | None]:
    y_true = pd.Series(y_true).to_numpy()
    y_pred = pd.Series(y_pred).to_numpy()
    metrics: dict[str, float | None] = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, y_pred)),
        "precision_macro": float(precision_score(y_true, y_pred, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_true, y_pred, average="macro", zero_division=0)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "roc_auc": None,
    }
    if y_proba is not None:
        metrics["roc_auc"] = _safe_roc_auc(y_true, y_proba)
    return metrics


def _safe_roc_auc(y_true: np.ndarray, y_proba: np.ndarray) -> float | None:
    classes = np.unique(y_true)
    if classes.size < 2:
        return None
    try:
        if y_proba.ndim == 2 and y_proba.shape[1] == 2:
            return float(roc_auc_score(y_true, y_proba[:, 1]))
        if y_proba.ndim == 2 and y_proba.shape[1] > 2:
            return float(roc_auc_score(y_true, y_proba, multi_class="ovr", average="macro"))
    except Exception:
        return None
    return None


def bootstrap_ci(
    y_true: pd.Series,
    y_pred: pd.Series,
    metric: str = "macro_f1",
    n_boot: int = 1000,
    seed: int = RANDOM_STATE,
) -> tuple[float, float]:
    """Percentile bootstrap confidence interval for a single metric."""
    from sklearn.metrics import f1_score as _f1

    y_true = np.asarray(y_true)
    y_pred = np.asarray(y_pred)
    rng = np.random.default_rng(seed)
    scores = []
    n = len(y_true)
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        sample_true = y_true[idx]
        sample_pred = y_pred[idx]
        if np.unique(sample_true).size < 2:
            continue
        scores.append(_f1(sample_true, sample_pred, average="macro", zero_division=0))
    if not scores:
        return (float("nan"), float("nan"))
    lower, upper = np.percentile(scores, [2.5, 97.5])
    return float(lower), float(upper)
