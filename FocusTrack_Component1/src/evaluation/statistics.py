"""Statistical analysis of evaluation results (proposal section 3.11.5).

Reports the *magnitude and consistency* of differences rather than a single
accuracy value: paired tests across folds, effect sizes, bootstrap confidence
intervals for the mean difference, and variation between participants and
between learning contexts.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats

from src.config import RANDOM_STATE
from src.evaluation.metrics import compute_metrics
from src.models.dataset import LABEL_COL
from src.models.train import fit_predict

PRIMARY_METRIC = "macro_f1"


# ---------------------------------------------------------------------------
# Effect sizes and intervals
# ---------------------------------------------------------------------------

def cliffs_delta(a: np.ndarray, b: np.ndarray) -> float:
    """Non-parametric effect size in [-1, 1] for two paired samples."""
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if a.size == 0 or b.size == 0:
        return float("nan")
    greater = 0
    for x in a:
        for y in b:
            greater += int(x > y) - int(x < y)
    return float(greater / (a.size * b.size))


def cohens_dz(differences: np.ndarray) -> float:
    """Paired Cohen's d (mean difference divided by its standard deviation)."""
    differences = np.asarray(differences, dtype=float)
    if differences.size < 2:
        return float("nan")
    std = differences.std(ddof=1)
    if std < 1e-12:
        return float("inf") if abs(differences.mean()) > 1e-12 else 0.0
    return float(differences.mean() / std)


def bootstrap_mean_ci(
    values: np.ndarray,
    n_boot: int = 2000,
    level: float = 0.95,
    seed: int = RANDOM_STATE,
) -> tuple[float, float]:
    values = np.asarray(values, dtype=float)
    values = values[np.isfinite(values)]
    if values.size == 0:
        return (float("nan"), float("nan"))
    if values.size == 1:
        return (float(values[0]), float(values[0]))
    rng = np.random.default_rng(seed)
    samples = rng.choice(values, size=(n_boot, values.size), replace=True).mean(axis=1)
    lower = (1 - level) / 2
    low, high = np.percentile(samples, [lower * 100, (1 - lower) * 100])
    return float(low), float(high)


# ---------------------------------------------------------------------------
# Paired comparison
# ---------------------------------------------------------------------------

def paired_comparison(
    reference: np.ndarray,
    target: np.ndarray,
    alternative: str = "two-sided",
    n_boot: int = 2000,
    seed: int = RANDOM_STATE,
) -> dict:
    reference = np.asarray(reference, dtype=float)
    target = np.asarray(target, dtype=float)
    size = min(reference.size, target.size)
    reference, target = reference[:size], target[:size]
    difference = target - reference  # positive => target is better

    result = {
        "n": int(size),
        "mean_reference": float(reference.mean()) if size else float("nan"),
        "mean_target": float(target.mean()) if size else float("nan"),
        "mean_delta": float(difference.mean()) if size else float("nan"),
        "median_delta": float(np.median(difference)) if size else float("nan"),
        "ci_low": float("nan"),
        "ci_high": float("nan"),
        "p_wilcoxon": float("nan"),
        "p_ttest": float("nan"),
        "cohens_dz": float("nan"),
        "cliffs_delta": float("nan"),
    }
    if size == 0:
        return result

    result["ci_low"], result["ci_high"] = bootstrap_mean_ci(difference, n_boot=n_boot, seed=seed)
    result["cohens_dz"] = cohens_dz(difference)
    result["cliffs_delta"] = cliffs_delta(target, reference)

    if size >= 3 and np.any(difference != 0):
        try:
            result["p_wilcoxon"] = float(stats.wilcoxon(reference, target, alternative=alternative).pvalue)
        except Exception:
            pass
        # t-test is undefined when every paired difference is identical.
        if difference.std(ddof=1) > 1e-12:
            try:
                result["p_ttest"] = float(
                    stats.ttest_rel(reference, target, alternative=alternative).pvalue
                )
            except Exception:
                pass
    return result


def compare_representations(
    results: pd.DataFrame,
    reference: str = "baseline",
    targets: list[str] | None = None,
    metric: str = PRIMARY_METRIC,
    split: str = "participant",
    seed: int = RANDOM_STATE,
) -> pd.DataFrame:
    """Paired comparison of each target representation against a reference.

    Folds are paired by ``(model, fold)`` so that each target is compared with
    the reference on identical splits. A positive ``mean_delta`` means the target
    representation performed better than the reference.
    """
    if results.empty or metric not in results.columns:
        return pd.DataFrame()

    folds = results[results["fold"] != "pooled"].copy()
    folds = folds[folds["split"] == split]
    if folds.empty:
        return pd.DataFrame()

    if targets is None:
        targets = [name for name in folds["representation"].unique() if name != reference]

    rows = []
    for target in targets:
        for model in sorted(folds["model"].unique()):
            base = folds[(folds["representation"] == reference) & (folds["model"] == model)]
            other = folds[(folds["representation"] == target) & (folds["model"] == model)]
            joined = pd.concat(
                [
                    base.set_index("fold")[metric].rename("reference"),
                    other.set_index("fold")[metric].rename("target"),
                ],
                axis=1,
            ).dropna()
            if len(joined) < 2:
                continue
            comparison = paired_comparison(
                joined["reference"].to_numpy(), joined["target"].to_numpy(), seed=seed
            )
            comparison.update(
                {
                    "reference": reference,
                    "target": target,
                    "model": model,
                    "split": split,
                    "metric": metric,
                }
            )
            rows.append(comparison)
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values(["model", "target"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# Between-participant and between-context variation
# ---------------------------------------------------------------------------

def leave_one_participant_out_predictions(
    dataset: pd.DataFrame,
    columns: list[str],
    *,
    label_col: str = LABEL_COL,
    model_name: str = "random_forest",
    seed: int = RANDOM_STATE,
) -> pd.DataFrame:
    """Predict each participant's sessions from a model trained on all others.

    This yields participant-level out-of-sample predictions, which is what the
    variation analysis in the proposal requires.
    """
    if dataset.empty or label_col not in dataset.columns:
        return pd.DataFrame()
    columns = [c for c in columns if c in dataset.columns]
    if not columns:
        return pd.DataFrame()

    data = dataset.reset_index(drop=True)
    X = data[columns].apply(pd.to_numeric, errors="coerce").fillna(0.0)
    y = data[label_col].reset_index(drop=True)

    rows = []
    for participant in data["participant_id"].dropna().unique():
        test_mask = (data["participant_id"] == participant).to_numpy()
        train_mask = ~test_mask
        if train_mask.sum() < 2 or test_mask.sum() == 0:
            continue
        try:
            predictions, _ = fit_predict(model_name, X[train_mask], y[train_mask], X[test_mask], seed=seed)
        except Exception:
            continue
        block = data.loc[test_mask, ["participant_id", "session_id", "context"]].copy()
        block["y_true"] = y[test_mask].to_numpy()
        block["y_pred"] = predictions
        block["model"] = model_name
        rows.append(block)
    if not rows:
        return pd.DataFrame()
    return pd.concat(rows, ignore_index=True)


def metric_by_group(
    predictions: pd.DataFrame,
    group_col: str,
    metric: str = PRIMARY_METRIC,
) -> pd.DataFrame:
    """Compute a classification metric per group (participant or context)."""
    if predictions.empty or group_col not in predictions.columns:
        return pd.DataFrame()
    rows = []
    for name, group in predictions.groupby(group_col, dropna=False):
        if group["y_true"].nunique() < 2:
            # A single-class group still yields a defined value but no balanced
            # accuracy; record the accuracy and leave the rest as NaN.
            rows.append(
                {
                    group_col: name,
                    "n_sessions": int(len(group)),
                    metric: float((group["y_true"] == group["y_pred"]).mean()),
                    "balanced_accuracy": float("nan"),
                }
            )
            continue
        metrics = compute_metrics(group["y_true"], group["y_pred"], None)
        rows.append(
            {
                group_col: name,
                "n_sessions": int(len(group)),
                metric: metrics.get(metric),
                "balanced_accuracy": metrics.get("balanced_accuracy"),
            }
        )
    return pd.DataFrame(rows)


def summarise_variation(per_group: pd.DataFrame, metric: str = PRIMARY_METRIC) -> dict:
    """Summarise the spread of a metric across groups."""
    if per_group.empty or metric not in per_group.columns:
        return {"n_groups": 0, "mean": float("nan"), "std": float("nan"), "min": float("nan"), "max": float("nan")}
    values = pd.to_numeric(per_group[metric], errors="coerce").dropna()
    if values.empty:
        return {"n_groups": 0, "mean": float("nan"), "std": float("nan"), "min": float("nan"), "max": float("nan")}
    return {
        "n_groups": int(values.size),
        "mean": float(values.mean()),
        "std": float(values.std(ddof=1)) if values.size > 1 else 0.0,
        "min": float(values.min()),
        "max": float(values.max()),
    }
