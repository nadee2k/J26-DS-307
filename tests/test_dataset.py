"""Label mapping and participant-level LNPO (no leakage)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from component3.dataset import join_labels, lnpo_folds, map_focus_label
from component3.types import FEATURE_COLUMNS


def test_map_focus_label(cfg: dict) -> None:
    th = cfg["model"]["focus_label_threshold"]
    assert map_focus_label(4, th) == 1
    assert map_focus_label(5, th) == 1
    assert map_focus_label(3, th) == 0
    assert map_focus_label(1, th) == 0


def test_lnpo_no_participant_leakage() -> None:
    groups = np.array(["A"] * 10 + ["B"] * 10 + ["C"] * 10 + ["D"] * 10 + ["E"] * 10)
    seen_test = set()
    for _fold, train_idx, test_idx in lnpo_folds(groups, n_folds=5, random_state=0):
        train_g = set(groups[train_idx])
        test_g = set(groups[test_idx])
        assert train_g.isdisjoint(test_g)
        seen_test |= test_g
    assert seen_test == set("ABCDE")


def test_join_labels_inner() -> None:
    features = pd.DataFrame(
        {
            "session_id": ["s1", "s1", "s2"],
            "participant_id": ["P1", "P1", "P2"],
            **{c: [0.1, 0.2, 0.3] for c in FEATURE_COLUMNS},
        }
    )
    labels = pd.DataFrame(
        {
            "session_id": ["s1", "s3"],
            "focus_rating": [5, 1],
            "y": [1, 0],
        }
    )
    merged = join_labels(features, labels)
    assert set(merged["session_id"]) == {"s1"}
    assert len(merged) == 2


def test_lnpo_requires_two_participants() -> None:
    groups = np.array(["only"] * 8)
    with pytest.raises(ValueError):
        list(lnpo_folds(groups, n_folds=5))
