"""Discover interaction states, their transitions, and the context encoding.

Usage:
    python scripts/run_states.py --config configs/c1_proposed.yaml

Requires ``data/processed/features.csv`` (run ``make data`` first).
Outputs:
    data/processed/state_sequences.csv
    data/processed/c1_representation.csv
    artifacts/states/state_selection.csv
    artifacts/states/state_profiles.csv
    artifacts/states/state_transition_matrix.csv
    artifacts/states/state_manifest.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from focustrack.config import load_config  # noqa: E402
from focustrack.context.encode import encode_context  # noqa: E402
from focustrack.states.hmm import HMMStateModel  # noqa: E402
from focustrack.states.profile import (  # noqa: E402
    interruption_states,
    label_states,
    state_sequence,
    transition_matrix,
)
from focustrack.states.sequences import build_sequences  # noqa: E402
from focustrack.states.select import (  # noqa: E402
    best_fit_row,
    seed_stability,
    select_n_states,
    selection_summary,
)
from focustrack.transitions.build import attach_transition_features  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", default="configs/c1_proposed.yaml")
    parser.add_argument("--features", default=None, help="path to features.csv")
    parser.add_argument("--states", type=int, default=None, help="override BIC selection")
    parser.add_argument("--seeds", type=int, default=None)
    args = parser.parse_args()

    cfg = load_config(ROOT / args.config)
    features_path = Path(args.features) if args.features else cfg.processed_dir / "features.csv"
    if not features_path.exists():
        raise FileNotFoundError(f"{features_path} not found; run `make data` first")

    epochs = pd.read_csv(features_path)
    X, lengths, meta = build_sequences(epochs, list(cfg.state_features))

    table = select_n_states(
        X,
        lengths,
        cfg,
        seeds=args.seeds,
        n_states_range=[args.states] if args.states else None,
    )
    summary = selection_summary(table)
    n_states = args.states or summary["k"]
    row = best_fit_row(table, n_states)

    model = HMMStateModel(
        n_states=n_states,
        feature_names=list(cfg.state_features),
        covariance_type=str(cfg.states.get("covariance_type", "diag")),
        seed=int(row["seed"]),
        n_iter=int(cfg.states.get("n_iter", 200)),
        tol=float(cfg.states.get("tol", 1e-4)),
    ).fit(X, lengths)
    states = model.predict(X, lengths)

    profiles = model.state_means(X, states)
    labels = label_states(profiles)
    profiles["label"] = labels
    interruptions = interruption_states(labels)

    matrix = transition_matrix(states, lengths, n_states, labels)
    sequence = state_sequence(meta, states, labels)
    sequence = sequence.merge(
        epochs[["session_id", "participant_id", "epoch_index", "study_mode", "typing_rate"]],
        on=["session_id", "participant_id", "epoch_index"],
        how="left",
        validate="one_to_one",
    )
    # In non-screen sessions an idle state is normal (reading); only computer
    # use counts as an interruption there (proposal 3.8).
    screen_mode = sequence["study_mode"].eq("screen")
    screen_interruption = sequence["state"].isin(interruptions)
    non_screen_interruption = sequence["state_label"].eq("Frequent switching") | (
        sequence["typing_rate"] >= cfg.min_keys_for_rhythm
    )
    sequence["interruption"] = np.where(
        screen_mode, screen_interruption, non_screen_interruption
    ).astype(int)
    sequence = attach_transition_features(
        sequence,
        interruption_states=interruptions,
        recovery_epochs=cfg.recovery_epochs,
        interruption_mask="interruption",
    )

    transition_columns = [
        "is_interruption",
        "state_dwell",
        "state_changes_5min",
        "time_since_interruption",
        "interruption_censored",
        "recovery_epochs",
        "recovered",
    ]
    representation = epochs.merge(
        sequence[["session_id", "participant_id", "epoch_index", "state", "state_label", *transition_columns]],
        on=["session_id", "participant_id", "epoch_index"],
        how="left",
    )
    representation = encode_context(representation, cfg, n_states=n_states)

    processed = cfg.processed_dir
    out_dir = cfg.artifacts_dir / "states"
    processed.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)

    sequence.to_csv(processed / "state_sequences.csv", index=False)
    representation.to_csv(processed / "c1_representation.csv", index=False)
    table.to_csv(out_dir / "state_selection.csv", index=False)
    profiles.to_csv(out_dir / "state_profiles.csv", index=False)
    matrix.to_csv(out_dir / "state_transition_matrix.csv")

    stability = seed_stability(X, lengths, cfg, n_states, runs=args.seeds)
    manifest = {
        "config": cfg.name,
        "state_features": list(cfg.state_features),
        "n_states": n_states,
        "selected_by": "override" if args.states else summary["rule"],
        "bic_medians": summary["bic_medians"],
        "marginal_gain_fraction": summary.get("marginal_gain_fraction", {}),
        "best_seed": int(row["seed"]),
        "bic": float(row["bic"]),
        "log_likelihood": float(row["log_likelihood"]),
        "converged": bool(row["converged"]),
        "state_labels": labels,
        "interruption_states": interruptions,
        "interruption_rule": (
            "screen: state in interruption states; non-screen: frequent switching "
            "or typing_rate >= min_keys_for_rhythm"
        ),
        "stability": stability,
        "epochs": int(len(epochs)),
        "sessions": int(epochs["session_id"].nunique()),
        "note": (
            "Exploratory state discovery on all participants. Evaluation refits the "
            "scaler and HMM inside each training fold (proposal 3.8)."
        ),
    }
    (out_dir / "state_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"states: {n_states} ({'override' if args.states else summary['rule']})")
    print(f"stability: mean ARI {stability['mean_ari']:.3f} (min {stability['min_ari']:.3f}, {stability['runs']} seeds)")
    print(profiles[["state", "label", "share", *cfg.state_features]].to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print(f"interruption-like states: {interruptions}")
    print(f"wrote {processed / 'state_sequences.csv'}")
    print(f"wrote {processed / 'c1_representation.csv'}")
    print(f"wrote {out_dir}/")


if __name__ == "__main__":
    main()
