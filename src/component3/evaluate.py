"""Per-module and end-to-end evaluation with majority baseline and mean ± std."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd

from component3.config import load_config, resolve_path
from component3.dataset import build_training_table, matrix_xy
from component3.models.train_baseline import build_rf, build_xgb, cross_validate_model


DAISEE_NOTE = (
    "Closest public benchmark (DAiSEE, 4-class engagement) sits mostly in the "
    "55–70% accuracy band; binary focus-vs-distraction should be somewhat easier. "
    "Do not present a single-split 90%+ figure."
)


def summarize_cv(summaries: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "daisee_framing": DAISEE_NOTE,
        "models": [
            {
                "model": s["model"],
                "n_folds": s["n_folds"],
                "accuracy": f"{s['accuracy_mean']:.3f} ± {s['accuracy_std']:.3f}"
                if s["accuracy_mean"] is not None else None,
                "precision": f"{s['precision_mean']:.3f} ± {s['precision_std']:.3f}"
                if s["precision_mean"] is not None else None,
                "recall": f"{s['recall_mean']:.3f} ± {s['recall_std']:.3f}"
                if s["recall_mean"] is not None else None,
                "f1": f"{s['f1_mean']:.3f} ± {s['f1_std']:.3f}"
                if s["f1_mean"] is not None else None,
                "majority_baseline_accuracy": f"{s['majority_baseline_accuracy_mean']:.3f} ± {s['majority_baseline_accuracy_std']:.3f}"
                if s["majority_baseline_accuracy_mean"] is not None else None,
                "majority_baseline_f1": f"{s['majority_baseline_f1_mean']:.3f} ± {s['majority_baseline_f1_std']:.3f}"
                if s["majority_baseline_f1_mean"] is not None else None,
                "raw": {
                    k: s[k] for k in s if k != "folds" and not k.startswith("_")
                },
            }
            for s in summaries
        ],
    }


def gaze_calibrated_vs_uncalibrated(frames_csv: Path) -> dict[str, Any]:
    """If frame-level on_screen labels exist (calibration hold-out), compare them."""
    if not Path(frames_csv).exists():
        return {"available": False}
    df = pd.read_csv(frames_csv)
    if "gaze_valid" not in df.columns:
        return {"available": False}
    valid = df[df["gaze_valid"] == True]  # noqa: E712
    out: dict[str, Any] = {
        "available": True,
        "n_valid_gaze_frames": int(len(valid)),
        "on_screen_rate": float(valid["on_screen"].mean()) if len(valid) and "on_screen" in valid.columns else None,
        "calibrated_rate": float(df["gaze_calibrated"].mean()) if "gaze_calibrated" in df.columns else None,
        "note": "Per-frame gaze GT is only available from a labelled calibration hold-out; otherwise report rates, not accuracy.",
    }
    return out


def phone_detection_placeholder(report_json: Path | None) -> dict[str, Any]:
    """Ultralytics val metrics if a fine-tune run wrote results."""
    if report_json and Path(report_json).exists():
        return json.loads(Path(report_json).read_text(encoding="utf-8"))
    return {
        "available": False,
        "note": (
            "Run `python -m component3 finetune-phone` then ultralytics val to populate "
            "Precision/Recall/mAP for the phone detector on a labelled pilot set."
        ),
    }


def evaluate(
    cfg: dict[str, Any],
    features_path: Path | None = None,
    labels_path: Path | None = None,
) -> dict[str, Any]:
    table = build_training_table(cfg, features_path=features_path, labels_path=labels_path)
    X, y, groups = matrix_xy(table)
    rf = cross_validate_model("random_forest", lambda: build_rf(cfg), X, y, groups, cfg)
    xgb = cross_validate_model("xgboost", lambda: build_xgb(cfg), X, y, groups, cfg)
    rf.pop("_last_model", None)
    xgb.pop("_last_model", None)
    payload = {
        "n_windows": int(len(table)),
        "n_participants": int(table["participant_id"].nunique()),
        "end_to_end": summarize_cv([rf, xgb]),
        "gaze": gaze_calibrated_vs_uncalibrated(
            resolve_path(cfg, "features_dir") / "all_frames.csv"
        ),
        "phone": phone_detection_placeholder(resolve_path(cfg, "reports_dir") / "phone_val.json"),
        "expression": {
            "enabled": bool(cfg["expression"]["enabled"]),
            "caveat": (
                "Expression is the lowest-confidence optional signal. FER2013-trained "
                "accuracy must not be presented as comparable to gaze/phone/pose."
            ),
        },
    }
    reports = resolve_path(cfg, "reports_dir")
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "evaluation.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate Component 3 visual classifier")
    parser.add_argument("--config", default=None)
    parser.add_argument("--features", default=None)
    parser.add_argument("--labels", default=None)
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    payload = evaluate(
        cfg,
        features_path=Path(args.features) if args.features else None,
        labels_path=Path(args.labels) if args.labels else None,
    )
    print(json.dumps(payload["end_to_end"], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
