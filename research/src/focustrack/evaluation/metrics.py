"""Classification metrics (proposal 3.7).

Macro-F1 is primary because the classes are imbalanced; balanced accuracy,
accuracy, macro precision/recall and ROC-AUC are secondary.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)


def _balanced_accuracy(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    matrix = confusion_matrix(y_true, y_pred, labels=[0, 1])
    recalls = [
        matrix[i, i] / matrix[i].sum()
        for i in (0, 1)
        if matrix[i].sum() > 0
    ]
    return float(np.mean(recalls)) if recalls else float("nan")


def classification_metrics(
    y_true: np.ndarray,
    y_prob: np.ndarray,
    threshold: float = 0.5,
) -> dict[str, float]:
    y_true = np.asarray(y_true, dtype=int)
    y_prob = np.asarray(y_prob, dtype=float)
    if len(y_true) == 0:
        return {
            key: float("nan")
            for key in (
                "macro_f1",
                "balanced_accuracy",
                "accuracy",
                "macro_precision",
                "macro_recall",
                "roc_auc",
                "prevalence",
                "n",
            )
        }

    y_pred = (y_prob >= threshold).astype(int)
    both_classes = len(np.unique(y_true)) == 2
    return {
        "macro_f1": float(
            f1_score(y_true, y_pred, average="macro", labels=[0, 1], zero_division=0)
        ),
        "balanced_accuracy": _balanced_accuracy(y_true, y_pred),
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_precision": float(
            precision_score(
                y_true, y_pred, average="macro", labels=[0, 1], zero_division=0
            )
        ),
        "macro_recall": float(
            recall_score(
                y_true, y_pred, average="macro", labels=[0, 1], zero_division=0
            )
        ),
        "roc_auc": float(roc_auc_score(y_true, y_prob)) if both_classes else float("nan"),
        "prevalence": float(np.mean(y_true)),
        "n": int(len(y_true)),
    }
