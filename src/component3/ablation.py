"""Visual-contribution ablation with mocked Component 1/2 features.

Fusion is concatenation + a shallow classifier (v2 §8). Deep cross-attention
is explicitly out of scope given ~80–120 labelled sessions project-wide.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from component3.config import load_config, resolve_path
from component3.dataset import build_training_table, matrix_xy
from component3.models.train_baseline import build_rf, cross_validate_model
from component3.types import FEATURE_COLUMNS


BEHAVIORAL_COLUMNS = [
    "wpm",
    "keystroke_latency_var",
    "error_ratio",
    "mouse_velocity",
    "idle_ratio",
    "app_switch_freq",
]
ENVIRONMENTAL_COLUMNS = [
    "temperature_c",
    "humidity_pct",
    "noise_db",
    "light_lux",
    "pir_motion_rate",
    "eci",
]


def mock_comp12_features(df: pd.DataFrame, random_state: int = 42) -> pd.DataFrame:
    """Synthetic Comp 1/2 columns with a mild, labelled correlation — not real teammate data.

    Focused windows get slightly higher WPM / lower idle / milder noise so the
    ablation can demonstrate a *procedure*, not a claimed real gain.
    """
    rng = np.random.RandomState(random_state)
    n = len(df)
    y = df["y"].to_numpy() if "y" in df.columns else np.zeros(n)
    out = df.copy()
    out["wpm"] = rng.normal(35, 8, n) + 8 * y
    out["keystroke_latency_var"] = np.abs(rng.normal(80, 20, n) - 10 * y)
    out["error_ratio"] = np.clip(rng.beta(2, 12, n) - 0.02 * y, 0, 1)
    out["mouse_velocity"] = np.abs(rng.normal(120, 40, n))
    out["idle_ratio"] = np.clip(rng.beta(2, 5, n) + 0.15 * (1 - y), 0, 1)
    out["app_switch_freq"] = np.abs(rng.normal(4, 2, n) + 2 * (1 - y))
    out["temperature_c"] = rng.normal(27.5, 1.8, n)
    out["humidity_pct"] = np.clip(rng.normal(72, 8, n), 20, 100)
    out["noise_db"] = rng.normal(42, 6, n) + 4 * (1 - y)
    out["light_lux"] = np.abs(rng.normal(280, 60, n))
    out["pir_motion_rate"] = np.clip(rng.beta(1.5, 6, n) + 0.1 * (1 - y), 0, 1)
    out["eci"] = (
        0.25 * (1 - np.abs(out["temperature_c"] - 26) / 10)
        + 0.25 * (1 - np.abs(out["humidity_pct"] - 60) / 50)
        + 0.25 * (1 - np.clip((out["noise_db"] - 30) / 40, 0, 1))
        + 0.25 * np.clip(out["light_lux"] / 400, 0, 1)
    )
    return out


def _cv_on_columns(df: pd.DataFrame, columns: list[str], cfg: dict[str, Any], name: str) -> dict[str, Any]:
    subset = df[columns + ["y", "participant_id"]].copy()
    X = subset[columns]
    y = subset["y"].to_numpy(dtype=int)
    groups = subset["participant_id"].astype(str).to_numpy()
    summary = cross_validate_model(name, lambda: build_rf(cfg), X, y, groups, cfg)
    summary.pop("_last_model", None)
    return {
        "setting": name,
        "n_features": len(columns),
        "f1_mean": summary["f1_mean"],
        "f1_std": summary["f1_std"],
        "accuracy_mean": summary["accuracy_mean"],
        "accuracy_std": summary["accuracy_std"],
        "majority_baseline_f1_mean": summary["majority_baseline_f1_mean"],
        "folds": summary["folds"],
    }


def run_ablation(
    cfg: dict[str, Any],
    features_path: Path | None = None,
    labels_path: Path | None = None,
    use_real_comp12: Path | None = None,
) -> dict[str, Any]:
    table = build_training_table(cfg, features_path=features_path, labels_path=labels_path)
    if use_real_comp12:
        extra = pd.read_csv(use_real_comp12) if str(use_real_comp12).endswith(".csv") else pd.read_parquet(use_real_comp12)
        join_key = "session_id" if "session_id" in extra.columns else None
        if join_key is None or "window_start" not in extra.columns:
            raise ValueError("Real Comp1/2 table must include session_id and window_start")
        table = table.merge(extra, on=["session_id", "window_start"], how="inner", suffixes=("", "_c12"))
        mocked = False
    else:
        table = mock_comp12_features(table, int(cfg["model"]["random_state"]))
        mocked = True

    visual = FEATURE_COLUMNS
    vis_beh = FEATURE_COLUMNS + BEHAVIORAL_COLUMNS
    all_three = FEATURE_COLUMNS + BEHAVIORAL_COLUMNS + ENVIRONMENTAL_COLUMNS
    results = [
        _cv_on_columns(table, visual, cfg, "visual_only"),
        _cv_on_columns(table, vis_beh, cfg, "visual_plus_behavioral"),
        _cv_on_columns(table, all_three, cfg, "visual_behavioral_environmental"),
    ]
    payload = {
        "mocked_comp12": mocked,
        "fusion": "feature concatenation + RandomForest (shallow late fusion)",
        "settings": [
            {k: r[k] for k in r if k != "folds"} for r in results
        ],
        "marginal_f1": {
            "visual_to_vis+beh": (
                None if results[0]["f1_mean"] is None or results[1]["f1_mean"] is None
                else results[1]["f1_mean"] - results[0]["f1_mean"]
            ),
            "vis+beh_to_all": (
                None if results[1]["f1_mean"] is None or results[2]["f1_mean"] is None
                else results[2]["f1_mean"] - results[1]["f1_mean"]
            ),
        },
        "folds": {r["setting"]: r["folds"] for r in results},
    }
    reports = resolve_path(cfg, "reports_dir")
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "ablation.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Visual contribution ablation")
    parser.add_argument("--config", default=None)
    parser.add_argument("--features", default=None)
    parser.add_argument("--labels", default=None)
    parser.add_argument("--comp12", default=None, help="Optional real Comp1/2 parquet/csv")
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    payload = run_ablation(
        cfg,
        features_path=Path(args.features) if args.features else None,
        labels_path=Path(args.labels) if args.labels else None,
        use_real_comp12=Path(args.comp12) if args.comp12 else None,
    )
    print(json.dumps({k: v for k, v in payload.items() if k != "folds"}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
