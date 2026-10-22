import numpy as np
import pandas as pd

from focustrack.evaluation.experiments import _run_fold
from focustrack.pipeline.fold import build_representation, enrich_fold


def make_epochs(participants=("p1", "p2"), n=20):
    rows = []
    for pid in participants:
        for t in range(n):
            active = (t % 10) < 5
            rows.append(
                {
                    "session_id": f"{pid}-s1",
                    "participant_id": pid,
                    "epoch_index": t,
                    "study_mode": "screen",
                    "task": "coding",
                    "typing_rate": 70.0 if active else 2.0,
                    "idle_ratio": 0.2 if active else 0.9,
                    "mouse_speed_px_s": 120.0 if active else 8.0,
                    "switch_rate": 2.5 if active else 0.1,
                    "inter_key_cv": 0.3 if active else np.nan,
                    "backspace_ratio": 0.1 if active else np.nan,
                    "is_missing_inter_key_cv": 0 if active else 1,
                    "is_missing_backspace_ratio": 0 if active else 1,
                }
            )
    return pd.DataFrame(rows)


def make_probes():
    rows = []
    for pid in ("p1", "p2"):
        for epoch, rating in ((5, 2), (15, 4)):
            rows.append(
                {
                    "session_id": f"{pid}-s1",
                    "participant_id": pid,
                    "epoch_index": epoch,
                    "rating": rating,
                }
            )
    return pd.DataFrame(rows)


def test_enrich_fold_adds_states_and_transitions(cfg):
    epochs = make_epochs()
    train = epochs[epochs["participant_id"] == "p1"]
    test = epochs[epochs["participant_id"] == "p2"]

    enriched = enrich_fold(train, test, cfg, n_states=2, seed=0)

    assert len(enriched.train) == len(train)
    assert len(enriched.test) == len(test)
    for column in ("state", "state_label", "state_dwell", "recovery_epochs", "is_interruption"):
        assert column in enriched.train.columns
    assert len(enriched.info["state_labels"]) == 2


def test_representation_is_aligned_and_complete(cfg):
    epochs = make_epochs()
    train = epochs[epochs["participant_id"] == "p1"].copy()
    test = epochs[epochs["participant_id"] == "p2"].copy()
    enriched = enrich_fold(train, test, cfg, n_states=2, seed=0)
    train = enriched.train.copy()
    test = enriched.test.copy()
    train["focus_label"] = [0] * 5 + [1] * 5 + [0] * 5 + [1] * 5
    test["focus_label"] = [0] * 5 + [1] * 5 + [0] * 5 + [1] * 5

    variant = {"aggregated": True, "temporal": True, "states": True, "transitions": True, "context": True}
    X_train, X_test, y_train, y_test, features = build_representation(
        train, test, cfg, n_states=2, variant=variant
    )

    assert X_train.shape[1] == X_test.shape[1] == len(features)
    assert not np.isnan(X_train).any() and not np.isnan(X_test).any()
    assert len(y_train) == len(X_train) and len(y_test) == len(X_test)
    assert "typing_rate" in features and "state_dwell" in features


def test_run_fold_end_to_end(cfg):
    epochs = make_epochs()
    probes = make_probes()
    train = epochs[epochs["participant_id"] == "p1"]
    test = epochs[epochs["participant_id"] == "p2"]
    variants = {
        "baseline": {"aggregated": True, "temporal": False, "states": False, "transitions": False, "context": False},
        "proposed": {"aggregated": True, "temporal": True, "states": True, "transitions": True, "context": True},
    }
    rows, predictions, info = _run_fold(
        train,
        test,
        probes[probes["participant_id"] == "p1"],
        probes[probes["participant_id"] == "p2"],
        cfg,
        2,
        variants,
        ["majority", "logreg"],
        split="lopo",
        fold="p2",
        participant="p2",
    )

    assert len(rows) == 4
    assert all("macro_f1" in row for row in rows)
    assert predictions and info["state_labels"]
