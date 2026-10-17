"""Candidate machine-learning models (proposal section 3.8)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import RANDOM_STATE


def available_models() -> list[str]:
    models = ["random_forest", "svm"]
    try:  # xgboost is optional at runtime
        import xgboost  # noqa: F401

        models.insert(1, "xgboost")
    except Exception:  # pragma: no cover - depends on environment
        pass
    return models


def make_model(name: str, seed: int = RANDOM_STATE):
    """Instantiate a candidate classifier by name."""
    if name == "random_forest":
        from sklearn.ensemble import RandomForestClassifier

        return RandomForestClassifier(
            n_estimators=300,
            random_state=seed,
            class_weight="balanced",
            n_jobs=-1,
        )
    if name == "svm":
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler
        from sklearn.svm import SVC

        # SVM is distance-based, so features must be standardised first.
        return Pipeline(
            [
                ("scaler", StandardScaler()),
                (
                    "model",
                    SVC(
                        C=1.0,
                        kernel="rbf",
                        probability=True,
                        class_weight="balanced",
                        random_state=seed,
                    ),
                ),
            ]
        )
    if name == "xgboost":
        from xgboost import XGBClassifier

        return XGBClassifier(
            n_estimators=300,
            max_depth=4,
            learning_rate=0.1,
            subsample=0.9,
            colsample_bytree=0.9,
            random_state=seed,
            eval_metric="mlogloss",
        )
    raise ValueError(f"Unknown model: {name}")


def fit_predict(
    model_name: str,
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_test: pd.DataFrame,
    seed: int = RANDOM_STATE,
) -> tuple[np.ndarray, np.ndarray | None]:
    """Fit a model on a training split and predict the held-out split.

    Returns the predicted labels and, when available, class probabilities.
    """
    from sklearn.preprocessing import LabelEncoder

    encoder = LabelEncoder()
    y_encoded = encoder.fit_transform(y_train)

    model = make_model(model_name, seed=seed)
    model.fit(np.nan_to_num(X_train.to_numpy(dtype=float)), y_encoded)
    predictions = encoder.inverse_transform(model.predict(np.nan_to_num(X_test.to_numpy(dtype=float))))

    probabilities = None
    if hasattr(model, "predict_proba"):
        try:
            raw = model.predict_proba(np.nan_to_num(X_test.to_numpy(dtype=float)))
            probabilities = raw
        except Exception:  # pragma: no cover
            probabilities = None
    return predictions, probabilities
