import numpy as np
import pandas as pd

from focustrack.evaluation.statistics import (
    bootstrap_ci,
    cohens_dz,
    compare_paired,
    paired_wilcoxon,
)


def test_paired_wilcoxon_and_effect_size():
    proposed = np.array([0.62, 0.70, 0.66, 0.80, 0.75, 0.72])
    baseline = np.array([0.50, 0.52, 0.55, 0.61, 0.58, 0.53])

    test = paired_wilcoxon(proposed, baseline)
    assert test["n"] == 6
    assert 0 <= test["p_value"] <= 1
    assert cohens_dz(proposed - baseline) > 1.0


def test_bootstrap_ci_contains_mean():
    diffs = np.array([0.1, 0.2, 0.15, 0.05, 0.12, 0.18])
    low, high = bootstrap_ci(diffs, n_boot=500, seed=1)
    assert low <= diffs.mean() <= high


def test_compare_paired_frame():
    frame = pd.DataFrame(
        {
            "participant": ["p1", "p1", "p2", "p2", "p3", "p3", "p4", "p4", "p5", "p5", "p6", "p6"],
            "representation": ["baseline", "proposed"] * 6,
            "macro_f1": [0.5, 0.6, 0.4, 0.55, 0.6, 0.62, 0.45, 0.5, 0.5, 0.58, 0.55, 0.6],
        }
    )
    result = compare_paired(frame, "participant", "macro_f1", "baseline", "proposed")

    assert result["n_participants"] == 6
    assert result["mean_diff"] > 0
    assert result["wilcoxon_p"] <= 1
