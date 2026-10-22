"""Build the epoch feature table and (for EDA) a probe-labelled copy.

Usage:
    python scripts/build_features.py --config configs/c1_proposed.yaml

Outputs (``data/processed/``):
    features.csv          one row per one-minute epoch, canonical columns
    labelled_epochs.csv   epochs in the 5 minutes before each probe (EDA only)
    manifest.json         counts, config and missingness summary
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from focustrack.config import EVENT_ONLY_COLUMNS, load_config  # noqa: E402
from focustrack.features.build import build_from_events, canonicalise_epochs  # noqa: E402
from focustrack.io import load_source  # noqa: E402
from focustrack.labels.probes import RatingNormaliser, label_epochs  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/c1_proposed.yaml")
    parser.add_argument("--source", default="simulated", choices=("simulated", "csv", "supabase"))
    parser.add_argument("--csv-dir", default=None, help="directory with sessions.csv/epochs.csv/probes.csv")
    args = parser.parse_args()

    cfg = load_config(ROOT / args.config)
    sessions, epochs, probes = load_source(args.source, cfg, args.csv_dir)

    events_path = Path(args.csv_dir) / "events.csv" if args.csv_dir else None
    if events_path and events_path.exists():
        features = build_from_events(pd.read_csv(events_path), sessions, cfg)
        built_from = "events"
    else:
        features = canonicalise_epochs(epochs, cfg, sessions=sessions)
        built_from = "aggregated epochs"

    # EDA-only labels: fitted on all probes so every epoch can be inspected.
    # Evaluation refits the normaliser inside each fold (see docs/DECISIONS.md).
    eda_norm = RatingNormaliser("within_learner").fit(probes)
    labelled = label_epochs(features, probes, cfg, normaliser=eda_norm)

    out_dir = cfg.processed_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    features.to_csv(out_dir / "features.csv", index=False)
    labelled.to_csv(out_dir / "labelled_epochs.csv", index=False)

    missing = {
        column: float(features[column].isna().mean())
        for column in EVENT_ONLY_COLUMNS
        if column in features.columns
    }
    manifest = {
        "config": cfg.name,
        "source": args.source,
        "built_from": built_from,
        "sessions": int(features["session_id"].nunique()),
        "participants": int(features["participant_id"].nunique()),
        "epochs": int(len(features)),
        "labelled_epochs": int(len(labelled)),
        "probe_window_epochs": cfg.probe_window_epochs,
        "missing_rate": missing,
        "note": (
            "Labelled epochs are fitted on all probes for EDA only. "
            "Evaluation must refit the normaliser inside each fold."
        ),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"features:  {out_dir / 'features.csv'}  ({len(features)} epochs)")
    print(f"labelled:  {out_dir / 'labelled_epochs.csv'}  ({len(labelled)} epochs)")
    print(f"built from: {built_from}")
    if missing:
        print("event-only features missing from this source:")
        for column, rate in missing.items():
            print(f"  {column:<24} {rate:6.1%}")


if __name__ == "__main__":
    main()
