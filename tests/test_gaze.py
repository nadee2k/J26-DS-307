"""Gaze heuristic, iris offsets, calibrator fit (headless)."""

from __future__ import annotations

import numpy as np

from component3.features.gaze import GazeEstimator, heuristic_on_screen, iris_offsets
from component3.features.gaze_calibration import fit_calibrator_from_arrays
from component3.features.face_pose import (
    LEFT_EYE,
    LEFT_IRIS_CENTER,
    RIGHT_EYE,
    RIGHT_IRIS_CENTER,
)


def _landmarks_centered() -> np.ndarray:
    lm = np.zeros((478, 2), dtype=np.float64)
    # Left eye around (100, 100), width 40, height 20
    lm[LEFT_EYE["outer"]] = [80, 100]
    lm[LEFT_EYE["inner"]] = [120, 100]
    lm[LEFT_EYE["top"]] = [100, 90]
    lm[LEFT_EYE["bottom"]] = [100, 110]
    lm[LEFT_IRIS_CENTER] = [100, 100]
    # Right eye around (200, 100)
    lm[RIGHT_EYE["outer"]] = [220, 100]
    lm[RIGHT_EYE["inner"]] = [180, 100]
    lm[RIGHT_EYE["top"]] = [200, 90]
    lm[RIGHT_EYE["bottom"]] = [200, 110]
    lm[RIGHT_IRIS_CENTER] = [200, 100]
    return lm


def test_iris_offsets_centered() -> None:
    ox, oy = iris_offsets(_landmarks_centered())
    assert abs(ox) < 1e-6
    assert abs(oy) < 1e-6


def test_heuristic_on_screen(cfg: dict) -> None:
    assert heuristic_on_screen(0.0, 0.0, 0.0, cfg) is True
    assert heuristic_on_screen(0.5, 0.0, 0.0, cfg) is False
    assert heuristic_on_screen(0.0, 0.0, 40.0, cfg) is False


def test_gaze_without_mesh_is_invalid(cfg: dict) -> None:
    est = GazeEstimator(cfg, participant_id=None)
    result = est.estimate(np.zeros((48, 64, 3), dtype=np.uint8), mesh=None, pose=None)
    assert result.valid is False
    assert result.on_screen is None


def test_fit_calibrator_separates_on_off() -> None:
    rng = np.random.RandomState(0)
    on = rng.normal(0, 0.05, size=(40, 5)).astype(np.float32)
    off = rng.normal(0.4, 0.05, size=(40, 5)).astype(np.float32)
    X = np.vstack([on, off])
    y = np.array([1] * 40 + [0] * 40)
    clf = fit_calibrator_from_arrays(X, y)
    pred = clf.predict(X)
    assert (pred == y).mean() >= 0.9
