import numpy as np
import pandas as pd

from src.evaluation.statistics import (
    bootstrap_mean_ci,
    cliffs_delta,
    cohens_dz,
    compare_representations,
    leave_one_participant_out_predictions,
    metric_by_group,
    paired_comparison,
    summarise_variation,
)
from src.models.dataset import build_session_dataset, select_features


def test_cliffs_delta_extremes():
    a = np.array([3.0, 3.0, 3.0])
    b = np.array([1.0, 1.0, 1.0])
    assert cliffs_delta(a, b) == 1.0
    assert cliffs_delta(b, a) == -1.0


def test_cohens_dz_constant_difference():
    assert cohens_dz(np.array([0.2, 0.2, 0.2])) == float("inf")


def test_bootstrap_mean_ci_brackets_mean():
    values = np.array([0.4, 0.5, 0.6, 0.45, 0.55])
    low, high = bootstrap_mean_ci(values, n_boot=500, seed=1)
    assert low <= values.mean() <= high


def test_paired_comparison_detects_improvement():
    reference = np.array([0.40, 0.45, 0.42, 0.48, 0.44])
    target = np.array([0.60, 0.65, 0.62, 0.68, 0.64])
    result = paired_comparison(reference, target, seed=1)
    assert result["mean_delta"] > 0
    assert result["ci_low"] > 0
    assert result["p_wilcoxon"] < 0.2
    assert result["cliffs_delta"] == 1.0


def _results_frame():
    rows = []
    for fold in range(4):
        rows.append({"representation": "baseline", "model": "random_forest", "split": "participant", "fold": f"fold{fold}", "macro_f1": 0.4 + 0.01 * fold})
        rows.append({"representation": "proposed", "model": "random_forest", "split": "participant", "fold": f"fold{fold}", "macro_f1": 0.55 + 0.01 * fold})
    return pd.DataFrame(rows)


def test_compare_representations():
    comparison = compare_representations(_results_frame(), reference="baseline", targets=["proposed"])
    assert len(comparison) == 1
    row = comparison.iloc[0]
    assert row["mean_delta"] > 0
    assert row["target"] == "proposed"


def test_variation_from_leave_one_participant_out(prepared):
    dataset, groups = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    dataset = dataset.dropna(subset=["concentration_label"])
    columns = select_features(groups, ["baseline", "temporal", "state", "transition", "context"])
    predictions = leave_one_participant_out_predictions(dataset, columns, model_name="random_forest")
    assert not predictions.empty
    participant_variation = metric_by_group(predictions, "participant_id")
    assert not participant_variation.empty
    summary = summarise_variation(participant_variation)
    assert summary["n_groups"] == predictions["participant_id"].nunique()
