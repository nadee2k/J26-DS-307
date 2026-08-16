"""Random Forest / XGBoost visual classifier with LNPO CV (v2 §6–§7).

Baseline first: class-weighted trees on engineered window vectors. SMOTE is
optional and applied only to *feature vectors* in the training fold.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.pipeline import Pipeline

from component3.config import load_config, resolve_path
from component3.dataset import build_training_table, lnpo_folds, matrix_xy
from component3.types import FEATURE_COLUMNS, WindowRecord


def _maybe_smote(X: np.ndarray, y: np.ndarray, enabled: bool, random_state: int):
    if not enabled:
        return X, y
    unique, counts = np.unique(y, return_counts=True)
    if len(unique) < 2:
        return X, y
    minority = int(counts.min())
    k = max(1, min(5, minority - 1))
    if k < 1:
        return X, y
    try:
        from imblearn.over_sampling import SMOTE

        sm = SMOTE(random_state=random_state, k_neighbors=k)
        return sm.fit_resample(X, y)
    except Exception:
        return X, y


def build_rf(cfg: dict[str, Any]) -> Pipeline:
    m = cfg["model"]
    max_depth = m.get("rf_max_depth")
    clf = RandomForestClassifier(
        n_estimators=int(m.get("rf_n_estimators", 200)),
        max_depth=None if max_depth in (None, "null") else int(max_depth),
        class_weight="balanced",
        random_state=int(m.get("random_state", 42)),
        n_jobs=-1,
    )
    return Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            ("clf", clf),
        ]
    )


def xgboost_available() -> bool:
    try:
        import xgboost  # noqa: F401

        return True
    except Exception:
        # Typical macOS failure: libomp.dylib missing. Fall back to sklearn's
        # HistGradientBoosting, which also handles NaN natively.
        return False


def build_xgb(cfg: dict[str, Any]):
    m = cfg["model"]
    if xgboost_available():
        from xgboost import XGBClassifier

        return XGBClassifier(
            n_estimators=int(m.get("xgb_n_estimators", 200)),
            max_depth=int(m.get("xgb_max_depth", 4)),
            learning_rate=float(m.get("xgb_learning_rate", 0.05)),
            objective="binary:logistic",
            eval_metric="logloss",
            n_jobs=-1,
            random_state=int(m.get("random_state", 42)),
            missing=np.nan,
            tree_method="hist",
        )
    from sklearn.ensemble import HistGradientBoostingClassifier

    return HistGradientBoostingClassifier(
        max_iter=int(m.get("xgb_n_estimators", 200)),
        max_depth=int(m.get("xgb_max_depth", 4)),
        learning_rate=float(m.get("xgb_learning_rate", 0.05)),
        class_weight="balanced",
        random_state=int(m.get("random_state", 42)),
    )


def _metrics(y_true: np.ndarray, y_pred: np.ndarray, y_proba: np.ndarray | None) -> dict[str, Any]:
    out = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "n": int(len(y_true)),
        "positive_rate": float(np.mean(y_true)),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist(),
    }
    if y_proba is not None and len(np.unique(y_true)) > 1:
        out["roc_auc"] = float(roc_auc_score(y_true, y_proba))
    else:
        out["roc_auc"] = None
    majority = int(np.bincount(y_true).argmax()) if len(y_true) else 0
    y_maj = np.full_like(y_true, majority)
    out["majority_baseline_accuracy"] = float(accuracy_score(y_true, y_maj))
    out["majority_baseline_f1"] = float(f1_score(y_true, y_maj, zero_division=0))
    out["majority_class"] = majority
    return out


def _predict_proba(model, X: np.ndarray) -> np.ndarray:
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(X)
        if proba.ndim == 2 and proba.shape[1] == 2:
            return proba[:, 1]
        return proba.ravel()
    if hasattr(model, "decision_function"):
        scores = model.decision_function(X)
        return 1.0 / (1.0 + np.exp(-scores))
    return model.predict(X).astype(float)


def cross_validate_model(
    name: str,
    factory,
    X: pd.DataFrame,
    y: np.ndarray,
    groups: np.ndarray,
    cfg: dict[str, Any],
) -> dict[str, Any]:
    m = cfg["model"]
    fold_rows = []
    last_model = None
    for fold, train_idx, test_idx in lnpo_folds(groups, int(m["n_folds"]), int(m["random_state"])):
        X_train = X.iloc[train_idx].to_numpy(dtype=float)
        X_test = X.iloc[test_idx].to_numpy(dtype=float)
        y_train = y[train_idx]
        y_test = y[test_idx]
        X_train, y_train = _maybe_smote(
            X_train, y_train, bool(m.get("use_smote", False)), int(m["random_state"]) + fold,
        )
        # XGBoost handles NaN natively; sklearn RF pipeline imputes.
        model = factory()
        if name == "xgboost" and "scale_pos_weight" in getattr(model, "get_params", dict)():
            scale = (y_train == 0).sum() / max((y_train == 1).sum(), 1)
            model.set_params(scale_pos_weight=float(scale))
        model.fit(X_train, y_train)
        last_model = model
        proba = _predict_proba(model, X_test)
        pred = (proba >= 0.5).astype(int)
        metrics = _metrics(y_test, pred, proba)
        metrics["fold"] = fold
        metrics["n_train_participants"] = int(len(np.unique(groups[train_idx])))
        metrics["n_test_participants"] = int(len(np.unique(groups[test_idx])))
        fold_rows.append(metrics)

    numeric_keys = ["accuracy", "precision", "recall", "f1", "roc_auc",
                    "majority_baseline_accuracy", "majority_baseline_f1"]
    summary = {"model": name, "n_folds": len(fold_rows), "folds": fold_rows}
    for key in numeric_keys:
        vals = [r[key] for r in fold_rows if r.get(key) is not None]
        if vals:
            summary[f"{key}_mean"] = float(np.mean(vals))
            summary[f"{key}_std"] = float(np.std(vals, ddof=0))
        else:
            summary[f"{key}_mean"] = None
            summary[f"{key}_std"] = None
    summary["_last_model"] = last_model
    return summary


class WindowPredictor:
    """Thin wrapper used at export/inference time."""

    def __init__(self, pipeline, feature_columns: list[str] | None = None) -> None:
        self.pipeline = pipeline
        self.feature_columns = feature_columns or FEATURE_COLUMNS

    def predict_proba_window(self, window: WindowRecord) -> float:
        vec = window.feature_vector()
        X = np.array([[vec[c] for c in self.feature_columns]], dtype=float)
        return float(_predict_proba(self.pipeline, X)[0])


def train_and_save(
    cfg: dict[str, Any],
    features_path: Path | None = None,
    labels_path: Path | None = None,
) -> dict[str, Any]:
    table = build_training_table(cfg, features_path=features_path, labels_path=labels_path)
    X, y, groups = matrix_xy(table)
    reports_dir = resolve_path(cfg, "reports_dir")
    artifacts_dir = resolve_path(cfg, "artifacts_dir")
    reports_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    results = []
    saved = {}
    for name, factory in (
        ("random_forest", lambda: build_rf(cfg)),
        ("xgboost", lambda: build_xgb(cfg)),
    ):
        summary = cross_validate_model(name, factory, X, y, groups, cfg)
        model = summary.pop("_last_model")
        path = artifacts_dir / f"{name}.joblib"
        joblib.dump({"model": model, "feature_columns": FEATURE_COLUMNS, "name": name}, path)
        saved[name] = str(path)
        results.append(summary)
        pd.DataFrame(summary["folds"]).to_csv(reports_dir / f"{name}_folds.csv", index=False)

    # Fit final RF on all data for live scoring (CV numbers remain the reported ones).
    final_rf = build_rf(cfg)
    X_all = X.to_numpy(dtype=float)
    y_all = y
    X_all, y_all = _maybe_smote(
        X_all, y_all, bool(cfg["model"].get("use_smote", False)), int(cfg["model"]["random_state"]),
    )
    final_rf.fit(X_all, y_all)
    final_path = artifacts_dir / "visual_classifier.joblib"
    joblib.dump({"model": final_rf, "feature_columns": FEATURE_COLUMNS, "name": "random_forest_full"}, final_path)

    payload = {
        "n_windows": int(len(table)),
        "n_participants": int(table["participant_id"].nunique()),
        "class_balance": {
            "focused": int((y == 1).sum()),
            "distracted": int((y == 0).sum()),
        },
        "models": results,
        "artifacts": {**saved, "visual_classifier": str(final_path)},
        "note": (
            "Headline numbers are mean ± std across Leave-N-Participants-Out folds. "
            "Compare against majority_baseline_*; DAiSEE-range framing applies."
        ),
    }
    out_json = reports_dir / "baseline_cv.json"
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Train RF/XGBoost visual focus classifier")
    parser.add_argument("--config", default=None)
    parser.add_argument("--features", default=None, help="Combined windows parquet/csv")
    parser.add_argument("--labels", default=None)
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    payload = train_and_save(
        cfg,
        features_path=Path(args.features) if args.features else None,
        labels_path=Path(args.labels) if args.labels else None,
    )
    printable = {k: v for k, v in payload.items() if k != "models"}
    print(json.dumps({**printable, "models": [
        {k: m[k] for k in m if k != "folds"} for m in payload["models"]
    ]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
