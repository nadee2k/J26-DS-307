"""Run the Component 1 experiment grid.

Usage:
    python scripts/run_experiments.py --split both
    python scripts/run_experiments.py --quick
    python scripts/run_experiments.py --models svm,random_forest --no-ablation

Outputs go to ``artifacts/runs/<timestamp>/`` unless ``--output`` is given.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

import pandas as pd  # noqa: E402

from focustrack.config import load_config  # noqa: E402
from focustrack.evaluation.experiments import (  # noqa: E402
    representation_variants,
    run_lopo,
    run_loto,
    summarise,
)

DEFAULT_MODELS = "svm,logreg,random_forest,xgboost,majority"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git_commit() -> str | None:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        return result.stdout.strip()
    except Exception:
        return None


def git_dirty() -> bool | None:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=True,
        )
        return bool(result.stdout.strip())
    except Exception:
        return None


def package_versions() -> dict[str, str]:
    from importlib.metadata import PackageNotFoundError, version

    names = ("pandas", "numpy", "scikit-learn", "scipy", "xgboost", "hmmlearn")
    out = {}
    for name in names:
        try:
            out[name] = version(name)
        except PackageNotFoundError:
            out[name] = "not installed"
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/c1_proposed.yaml")
    parser.add_argument("--features", default=None)
    parser.add_argument("--probes", default=None)
    parser.add_argument("--models", default=DEFAULT_MODELS)
    parser.add_argument("--split", default="both", choices=("lopo", "loto", "both"))
    parser.add_argument("--max-folds", type=int, default=None)
    parser.add_argument("--n-states", type=int, default=None)
    parser.add_argument("--ablation-model", default="svm")
    parser.add_argument("--no-ablation", action="store_false", dest="ablation")
    parser.add_argument("--output", default=None)
    parser.add_argument("--quick", action="store_true", help="3 folds, svm+logreg, LOPO only")
    args = parser.parse_args()

    if args.quick:
        args.models = "svm,logreg"
        args.max_folds = args.max_folds or 3
        args.split = "lopo"
        args.ablation = False

    started = time.time()
    started_at = datetime.now(timezone.utc).isoformat()
    cfg = load_config(ROOT / args.config)

    features_path = Path(args.features) if args.features else cfg.processed_dir / "features.csv"
    probes_path = Path(args.probes) if args.probes else cfg.raw_dir / "probes.csv"
    if not features_path.exists():
        raise FileNotFoundError(f"{features_path} not found; run `make data` first")
    features = pd.read_csv(features_path)
    probes = pd.read_csv(probes_path)

    manifest_path = cfg.artifacts_dir / "states" / "state_manifest.json"
    if args.n_states is not None:
        n_states = args.n_states
    elif manifest_path.exists():
        n_states = int(json.loads(manifest_path.read_text())["n_states"])
    else:
        n_states = 4

    models = [name.strip() for name in args.models.split(",") if name.strip()]
    variants = representation_variants(cfg)
    if not args.ablation:
        variants = {name: v for name, v in variants.items() if name in {"baseline", "proposed"}}

    rows: list[dict] = []
    predictions: list[pd.DataFrame] = []
    if args.split in {"lopo", "both"}:
        fold_rows, fold_preds = run_lopo(
            features,
            probes,
            cfg,
            n_states,
            models,
            variants,
            max_folds=args.max_folds,
            ablation_model=args.ablation_model,
        )
        rows.extend(fold_rows)
        predictions.extend(fold_preds)
    if args.split in {"loto", "both"}:
        fold_rows, fold_preds = run_loto(
            features,
            probes,
            cfg,
            n_states,
            models,
            variants,
            max_folds=args.max_folds,
            ablation_model=args.ablation_model,
        )
        rows.extend(fold_rows)
        predictions.extend(fold_preds)

    frames = summarise(rows, predictions, cfg)
    output = Path(args.output) if args.output else (
        cfg.artifacts_dir / "runs" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    )
    output.mkdir(parents=True, exist_ok=True)
    for name, frame in frames.items():
        frame.to_csv(output / f"{name}.csv", index=False)

    manifest = {
        "component": "C1",
        "config": cfg.name,
        "config_raw": cfg.raw,
        "started_at": started_at,
        "finished_at": datetime.now(timezone.utc).isoformat(),
        "runtime_seconds": round(time.time() - started, 1),
        "git_commit": git_commit(),
        "git_dirty": git_dirty(),
        "python": platform.python_version(),
        "packages": package_versions(),
        "data": {
            "features": str(features_path),
            "features_sha256": sha256(features_path),
            "probes": str(probes_path),
            "probes_sha256": sha256(probes_path),
            "epochs": int(len(features)),
            "sessions": int(features["session_id"].nunique()),
            "participants": int(features["participant_id"].nunique()),
        },
        "n_states": n_states,
        "models": models,
        "variants": variants,
        "split": args.split,
        "max_folds": args.max_folds,
        "ablation_model": args.ablation_model,
        "note": (
            "HMM, scaler, state labels and imputation medians are refitted inside "
            "each training fold; state count is fixed from the Phase 3 selection."
        ),
    }
    (output / "run_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"runtime: {manifest['runtime_seconds']} s")
    print(f"wrote: {output}")
    if "summary" in frames:
        summary = frames["summary"]
        lopo = summary[summary["split"] == "lopo"]
        if not lopo.empty:
            print("\nLOPO macro-F1 (mean over folds)")
            print(
                lopo.pivot_table(
                    index="representation", columns="model", values="macro_f1"
                ).round(3).to_string()
            )
        loto = summary[summary["split"] == "loto"]
        if not loto.empty:
            print("\nLOTO macro-F1 (mean over held-out tasks)")
            print(
                loto.pivot_table(
                    index="representation", columns="model", values="macro_f1"
                ).round(3).to_string()
            )
    if "statistics" in frames and not frames["statistics"].empty:
        print("\npaired statistics (macro-F1)")
        print(frames["statistics"].round(3).to_string(index=False))


if __name__ == "__main__":
    main()
