"""Command-line entry point for the FocusTrack Component 1 pipeline.

Examples
--------
Run on an existing raw CSV export::

    python scripts/run_pipeline.py --source csv --window 60 --states 4

Generate synthetic data, then run (useful before real data exists)::

    python scripts/run_pipeline.py --source synthetic --states 4

Pull fresh data from Supabase, export it, then run::

    python scripts/run_pipeline.py --source supabase
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.config import DEFAULT_N_STATES, DEFAULT_STATE_METHOD, DEFAULT_WINDOW_SECONDS
from src.database.data_loader import export_raw, load_raw
from src.pipeline import run_pipeline
from src.simulation import save_synthetic_raw


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the FocusTrack Component 1 pipeline.")
    parser.add_argument(
        "--source",
        choices=["csv", "supabase", "synthetic"],
        default="csv",
        help="Where the raw tables come from.",
    )
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW_SECONDS, help="Window size in seconds.")
    parser.add_argument("--states", type=int, default=DEFAULT_N_STATES, help="Number of interaction states.")
    parser.add_argument(
        "--method", choices=["kmeans", "gmm"], default=DEFAULT_STATE_METHOD, help="State discovery method."
    )
    parser.add_argument("--hidden", type=int, default=3, help="Number of hidden HMM regimes.")
    parser.add_argument("--no-ml", action="store_true", help="Skip the baseline/proposed experiments.")
    parser.add_argument("--no-save", action="store_true", help="Do not write artifacts to data/.")
    args = parser.parse_args()

    if args.source == "supabase":
        print("Exporting raw tables from Supabase...")
        export_raw()
        raw = load_raw()
    elif args.source == "synthetic":
        print("Generating synthetic raw data...")
        save_synthetic_raw()
        raw = load_raw()
    else:
        raw = load_raw()

    if not raw or all(frame.empty for frame in raw.values()):
        print("No raw data found. Populate data/raw/*.csv or use --source synthetic.")
        return 1

    bundle = run_pipeline(
        raw,
        window_seconds=args.window,
        n_states=args.states,
        state_method=args.method,
        n_hidden=args.hidden,
        save=not args.no_save,
        run_ml=not args.no_ml,
    )

    features = bundle["features"]
    dataset = bundle["dataset"]
    print(f"Events:   {len(bundle['events'])}")
    print(f"Windows:  {len(bundle['windows'])}")
    print(f"Features: {len(features)} windows x {features.shape[1]} columns")
    print(f"Sessions: {len(dataset)}")
    print(f"Cluster quality: {bundle['cluster_quality']}")

    summary = bundle["summary"]
    if not summary.empty:
        print("\nRepresentation comparison (mean Macro-F1 across folds):")
        print(summary[["representation", "model", "split", "macro_f1_mean", "macro_f1_std"]].to_string(index=False))

    hmm_summary = bundle.get("hmm_summary")
    if hmm_summary is not None and not hmm_summary.empty:
        print("\nSequential (HMM) augmentation (mean Macro-F1 across folds):")
        print(
            hmm_summary[["representation", "model", "split", "macro_f1_mean", "macro_f1_std"]].to_string(
                index=False
            )
        )

    statistics = bundle.get("statistics")
    if statistics is not None and not statistics.empty:
        print("\nPaired comparison vs baseline (positive delta favours the target):")
        print(
            statistics[
                ["target", "model", "mean_reference", "mean_target", "mean_delta", "ci_low", "ci_high", "p_wilcoxon"]
            ].to_string(index=False)
        )

    variation = bundle.get("variation")
    if variation is not None and not variation.empty:
        print("\nVariation across groups:")
        print(variation.to_string(index=False))

    if not args.no_save:
        print("\nArtifacts written under data/ (processed, features, sequences, results).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
