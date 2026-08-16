"""Phone stub, expression-disabled default, ablation + baseline smoke on synthetic data."""

from __future__ import annotations

from pathlib import Path

import numpy as np

from component3.ablation import mock_comp12_features, run_ablation
from component3.dataset import build_training_table
from component3.features.expression import ExpressionClassifier
from component3.features.phone_detect import PhoneDetector
from component3.models.train_baseline import train_and_save
from component3.synthetic import write_synthetic


def test_phone_stub_never_detects(cfg: dict) -> None:
    det = PhoneDetector(cfg, stub=True)
    out = det.detect(np.zeros((64, 64, 3), dtype=np.uint8))
    assert out.present is False
    assert out.confidence == 0.0


def test_expression_disabled_by_default(cfg: dict) -> None:
    assert cfg["expression"]["enabled"] is False
    clf = ExpressionClassifier(cfg)
    result = clf.predict(np.zeros((224, 224, 3), dtype=np.uint8))
    assert result.valid is False
    assert result.label is None


def test_baseline_and_ablation_on_synthetic(cfg: dict, tmp_path: Path) -> None:
    info = write_synthetic(cfg, n_participants=8, out=tmp_path / "windows.parquet")
    payload = train_and_save(
        cfg,
        features_path=Path(info["features"]),
        labels_path=Path(info["labels"]),
    )
    assert payload["n_participants"] == 8
    assert payload["n_windows"] > 0
    rf = next(m for m in payload["models"] if m["model"] == "random_forest")
    assert rf["n_folds"] >= 2
    assert rf["accuracy_mean"] is not None
    assert "majority_baseline_accuracy_mean" in rf
    # Majority baseline must be reported alongside the model
    assert rf["majority_baseline_accuracy_mean"] >= 0

    ab = run_ablation(
        cfg,
        features_path=Path(info["features"]),
        labels_path=Path(info["labels"]),
    )
    names = {s["setting"] for s in ab["settings"]}
    assert names == {
        "visual_only",
        "visual_plus_behavioral",
        "visual_behavioral_environmental",
    }
    assert ab["mocked_comp12"] is True


def test_mock_comp12_adds_columns() -> None:
    import pandas as pd

    df = pd.DataFrame({"y": [0, 1, 1, 0]})
    out = mock_comp12_features(df, random_state=0)
    assert "wpm" in out.columns
    assert "eci" in out.columns
    assert len(out) == 4
