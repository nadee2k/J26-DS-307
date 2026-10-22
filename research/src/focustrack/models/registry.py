"""Model registry (proposal 3.5-3.6).

The same classifier is used on every representation, so differences are
attributable to the representation, not to model capacity. Hyperparameters are
fixed defaults; the research question is the representation, not tuning.
"""

from __future__ import annotations

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

from focustrack.models.majority import MajorityClassifier

MODEL_NAMES = ("majority", "logreg", "svm", "random_forest", "xgboost")


def build_classifier(name: str, seed: int = 42, y: np.ndarray | None = None):
    """Return an unfitted classifier behind the ``fit``/``predict_proba`` API."""
    if name == "majority":
        return MajorityClassifier()
    if name == "logreg":
        return Pipeline(
            [
                ("scale", StandardScaler()),
                (
                    "model",
                    LogisticRegression(
                        max_iter=1000,
                        class_weight="balanced",
                        random_state=seed,
                    ),
                ),
            ]
        )
    if name == "svm":
        return Pipeline(
            [
                ("scale", StandardScaler()),
                (
                    "model",
                    SVC(
                        kernel="rbf",
                        C=1.0,
                        class_weight="balanced",
                        probability=True,
                        random_state=seed,
                    ),
                ),
            ]
        )
    if name == "random_forest":
        return RandomForestClassifier(
            n_estimators=300,
            class_weight="balanced",
            random_state=seed,
            n_jobs=-1,
        )
    if name == "xgboost":
        from xgboost import XGBClassifier

        scale_pos_weight = 1.0
        if y is not None and len(np.unique(y)) == 2:
            positives = float(np.sum(y == 1))
            negatives = float(np.sum(y == 0))
            if positives > 0:
                scale_pos_weight = negatives / positives
        return XGBClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.9,
            colsample_bytree=0.9,
            scale_pos_weight=scale_pos_weight,
            eval_metric="logloss",
            random_state=seed,
            n_jobs=-1,
        )
    raise ValueError(f"unknown model {name!r}; choose from {', '.join(MODEL_NAMES)}")
