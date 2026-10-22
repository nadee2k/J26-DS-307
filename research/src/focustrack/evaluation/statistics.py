"""Paired statistics across participants (proposal 3.8).

Significance is tested across participants, not across folds. Effect sizes and
a bootstrap interval are reported alongside the p-value.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import wilcoxon


def paired_wilcoxon(a: np.ndarray, b: np.ndarray) -> dict[str, float]:
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    mask = np.isfinite(a) & np.isfinite(b)
    diffs = a[mask] - b[mask]
    if len(diffs) < 6 or np.allclose(diffs, 0):
        return {"n": int(len(diffs)), "statistic": float("nan"), "p_value": float("nan")}
    statistic, p_value = wilcoxon(diffs, alternative="two-sided")
    return {"n": int(len(diffs)), "statistic": float(statistic), "p_value": float(p_value)}


def bootstrap_ci(diffs: np.ndarray, n_boot: int = 2000, seed: int = 42) -> tuple[float, float]:
    diffs = np.asarray(diffs, dtype=float)
    diffs = diffs[np.isfinite(diffs)]
    if len(diffs) == 0:
        return (float("nan"), float("nan"))
    rng = np.random.default_rng(seed)
    means = np.array(
        [rng.choice(diffs, size=len(diffs), replace=True).mean() for _ in range(n_boot)]
    )
    return (float(np.percentile(means, 2.5)), float(np.percentile(means, 97.5)))


def cohens_dz(diffs: np.ndarray) -> float:
    diffs = np.asarray(diffs, dtype=float)
    diffs = diffs[np.isfinite(diffs)]
    if len(diffs) < 2:
        return float("nan")
    sd = float(np.std(diffs, ddof=1))
    return float(np.mean(diffs) / sd) if sd > 0 else float("nan")


def compare_paired(
    frame: pd.DataFrame,
    group_col: str,
    value_col: str,
    baseline: str,
    proposed: str,
    representation_col: str = "representation",
) -> dict[str, float | str]:
    """Paired proposed-vs-baseline comparison across participants."""
    pivot = frame.pivot_table(
        index=group_col, columns=representation_col, values=value_col, aggfunc="mean"
    )
    if baseline not in pivot.columns or proposed not in pivot.columns:
        raise ValueError(f"need both {baseline!r} and {proposed!r} in {representation_col}")
    paired = pivot[[baseline, proposed]].dropna()
    diffs = paired[proposed].to_numpy() - paired[baseline].to_numpy()
    low, high = bootstrap_ci(diffs)
    test = paired_wilcoxon(paired[proposed].to_numpy(), paired[baseline].to_numpy())
    return {
        "baseline": baseline,
        "proposed": proposed,
        "n_participants": int(len(paired)),
        "mean_baseline": float(paired[baseline].mean()),
        "mean_proposed": float(paired[proposed].mean()),
        "mean_diff": float(np.mean(diffs)) if len(diffs) else float("nan"),
        "ci_low": low,
        "ci_high": high,
        "cohens_dz": cohens_dz(diffs),
        "wilcoxon_statistic": test["statistic"],
        "wilcoxon_p": test["p_value"],
    }
