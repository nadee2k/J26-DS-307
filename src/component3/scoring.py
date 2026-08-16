"""Heuristic and model-backed visual_focus_score (0–100)."""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from component3.types import WindowRecord


def heuristic_focus_score(window: WindowRecord, cfg: dict[str, Any]) -> tuple[float, float]:
    """Interpretable fallback used when no trained classifier is loaded.

    Confidence shrinks as validity ratios drop so 'couldn't tell' is not
    exported as 'no distraction detected'.
    """
    mcfg = cfg.get("model", {})
    phone_w = float(mcfg.get("score_phone_weight", 40.0))
    off_w = float(mcfg.get("score_offscreen_weight", 30.0))
    away_w = float(mcfg.get("score_away_weight", 20.0))
    off = window.off_screen_gaze_ratio if window.off_screen_gaze_ratio is not None else 0.0
    penalty = (
        phone_w * window.phone_present_ratio
        + off_w * off
        + away_w * window.away_from_desk_ratio
    )
    score = float(np.clip(100.0 - penalty, 0.0, 100.0))
    coverage = (
        0.4 * window.face_present_ratio
        + 0.4 * window.gaze_valid_ratio
        + 0.2 * (1.0 if window.n_frames else 0.0)
    )
    confidence = float(np.clip(coverage, 0.0, 1.0))
    return score, confidence


def model_focus_score(proba_focused: float, window: WindowRecord) -> tuple[float, float]:
    score = float(np.clip(proba_focused * 100.0, 0.0, 100.0))
    coverage = 0.5 * window.face_present_ratio + 0.5 * window.gaze_valid_ratio
    confidence = float(np.clip(0.3 + 0.7 * coverage, 0.0, 1.0))
    return score, confidence


def score_window(
    window: WindowRecord,
    cfg: dict[str, Any],
    predictor: Optional[Any] = None,
) -> WindowRecord:
    if predictor is not None:
        proba = predictor.predict_proba_window(window)
        score, conf = model_focus_score(proba, window)
    else:
        score, conf = heuristic_focus_score(window, cfg)
    window.visual_focus_score = score
    window.confidence = conf
    window.phone_detected = window.phone_present_ratio > 0.0
    return window
