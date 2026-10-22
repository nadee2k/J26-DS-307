import numpy as np

from focustrack.evaluation.metrics import classification_metrics


def test_perfect_predictions():
    metrics = classification_metrics(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.8, 0.9]))
    assert metrics["macro_f1"] == 1.0
    assert metrics["balanced_accuracy"] == 1.0
    assert metrics["roc_auc"] == 1.0


def test_single_class_has_undefined_auc():
    metrics = classification_metrics(np.array([1, 1, 1]), np.array([0.6, 0.7, 0.8]))
    assert np.isnan(metrics["roc_auc"])
    # macro-F1 includes the absent class, whose F1 is zero
    assert metrics["macro_f1"] == 0.5


def test_empty_input_returns_nan():
    metrics = classification_metrics(np.array([]), np.array([]))
    assert np.isnan(metrics["macro_f1"])
    assert np.isnan(metrics["n"])
