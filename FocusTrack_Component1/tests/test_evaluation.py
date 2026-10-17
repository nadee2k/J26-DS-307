import pandas as pd

from src.evaluation.experiments import REPRESENTATIONS, run_experiments, summarise
from src.evaluation.metrics import compute_metrics
from src.evaluation.splits import leave_one_context_out, participant_folds
from src.models.dataset import build_session_dataset


def test_participant_folds_prevent_leakage():
    groups = pd.Series(["a", "a", "b", "b", "c", "c", "d", "d"])
    folds = participant_folds(groups, n_splits=2)
    assert folds
    for train_idx, test_idx in folds:
        assert not (set(groups.iloc[train_idx]) & set(groups.iloc[test_idx]))


def test_leave_one_context_out():
    contexts = pd.Series(["coding", "coding", "reading", "reading"])
    splits = leave_one_context_out(contexts)
    assert {name for name, _, _ in splits} == {"coding", "reading"}
    for _, train_idx, test_idx in splits:
        assert set(contexts.iloc[train_idx]) & set(contexts.iloc[test_idx]) == set()


def test_compute_metrics_perfect_prediction():
    y = pd.Series([1, 2, 3, 1, 2, 3])
    metrics = compute_metrics(y, y.copy())
    assert metrics["macro_f1"] == 1.0
    assert metrics["accuracy"] == 1.0


def test_run_experiments_smoke(prepared):
    dataset, groups = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    dataset = dataset[dataset["concentration_label"].notna()]
    results = run_experiments(
        dataset,
        groups,
        model_names=["random_forest"],
        split_schemes=("participant",),
        n_splits=3,
    )
    assert not results.empty
    assert set(results["representation"]).issubset(set(REPRESENTATIONS))
    summary = summarise(results)
    assert not summary.empty
    assert "macro_f1_mean" in summary.columns
