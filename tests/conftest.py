"""Shared pytest fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from component3.config import DEFAULT_CONFIG_PATH, load_config


@pytest.fixture
def cfg(tmp_path: Path) -> dict:
    base = load_config(DEFAULT_CONFIG_PATH)
    base["model"]["rf_n_estimators"] = 20
    base["model"]["xgb_n_estimators"] = 20
    base["model"]["n_folds"] = 4
    base["paths"]["data_dir"] = str(tmp_path / "data")
    base["paths"]["raw_dir"] = str(tmp_path / "data" / "raw")
    base["paths"]["calibration_dir"] = str(tmp_path / "data" / "calibration")
    base["paths"]["labels_file"] = str(tmp_path / "data" / "labels" / "session_labels.csv")
    base["paths"]["consent_file"] = str(tmp_path / "data" / "consent" / "consent_records.csv")
    base["paths"]["frames_dir"] = str(tmp_path / "data" / "processed" / "frames")
    base["paths"]["features_dir"] = str(tmp_path / "data" / "processed" / "features")
    base["paths"]["artifacts_dir"] = str(tmp_path / "artifacts")
    base["paths"]["reports_dir"] = str(tmp_path / "reports")
    base["paths"]["schema_dir"] = str(tmp_path / "schema")
    for key in (
        "raw_dir",
        "calibration_dir",
        "frames_dir",
        "features_dir",
        "artifacts_dir",
        "reports_dir",
        "schema_dir",
    ):
        Path(base["paths"][key]).mkdir(parents=True, exist_ok=True)
    Path(base["paths"]["labels_file"]).parent.mkdir(parents=True, exist_ok=True)
    Path(base["paths"]["consent_file"]).parent.mkdir(parents=True, exist_ok=True)
    return base


@pytest.fixture
def cfg_file(cfg: dict, tmp_path: Path) -> Path:
    path = tmp_path / "test.yaml"
    dumped = {k: v for k, v in cfg.items() if not str(k).startswith("_")}
    path.write_text(yaml.safe_dump(dumped), encoding="utf-8")
    return path
