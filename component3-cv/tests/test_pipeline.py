"""Pipeline processes synthetic frames without crashing (MediaPipe optional)."""

from __future__ import annotations

import numpy as np

from component3.benchmark import run_benchmark, synthetic_frame
from component3.pipeline import VisualPipeline


def test_pipeline_on_blank_frame(cfg: dict) -> None:
    pipe = VisualPipeline(cfg, participant_id=None, stub_phone=True)
    try:
        rec = pipe.process_frame(
            np.zeros((720, 1280, 3), dtype=np.uint8),
            session_id="s",
            participant_id="P",
            cohort="screen",
            frame_index=0,
            timestamp="2026-03-01T00:00:00+00:00",
        )
    finally:
        pipe.close()
    assert rec.session_id == "s"
    assert rec.away_from_desk in {True, False}
    assert rec.expression_valid is False


def test_benchmark_synthetic(cfg: dict) -> None:
    payload = run_benchmark(cfg, n_frames=4, stub_phone=True, use_camera=False)
    assert payload["n_frames"] == 4
    assert payload["max_sustainable_fps"] > 0
    assert "meets_target" in payload


def test_synthetic_frame_shape() -> None:
    frame = synthetic_frame(128, 96, seed=1)
    assert frame.shape == (96, 128, 3)
