"""Window aggregation and validity-ratio policy."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from component3.types import FrameRecord
from component3.windowing import window_frames


def _frame(i: int, **kwargs) -> FrameRecord:
    start = datetime(2026, 3, 1, 12, 0, 0, tzinfo=timezone.utc)
    ts = (start + timedelta(seconds=i)).isoformat()
    defaults = dict(
        session_id="s1",
        participant_id="P001",
        cohort="screen",
        timestamp=ts,
        frame_index=i,
        face_present=True,
        face_valid=True,
        away_from_desk=False,
        gaze_valid=True,
        on_screen=True,
    )
    defaults.update(kwargs)
    return FrameRecord(**defaults)


def test_off_screen_ratio_uses_valid_gaze_only() -> None:
    frames = [
        _frame(0, gaze_valid=True, on_screen=False),
        _frame(1, gaze_valid=True, on_screen=True),
        _frame(2, gaze_valid=False, on_screen=None),
        _frame(3, gaze_valid=False, on_screen=None),
        _frame(4, gaze_valid=True, on_screen=False),
    ]
    windows = window_frames(frames, window_seconds=5)
    assert len(windows) == 1
    w = windows[0]
    # 3 valid gaze frames, 2 off-screen → 2/3, not 2/5
    assert w.gaze_valid_ratio == 3 / 5
    assert abs(w.off_screen_gaze_ratio - (2 / 3)) < 1e-9


def test_no_valid_gaze_leaves_off_screen_none() -> None:
    frames = [_frame(i, gaze_valid=False, on_screen=None) for i in range(5)]
    w = window_frames(frames, 5)[0]
    assert w.gaze_valid_ratio == 0.0
    assert w.off_screen_gaze_ratio is None


def test_expression_dominant_unavailable_when_invalid() -> None:
    frames = [_frame(i, expression_valid=False) for i in range(5)]
    w = window_frames(frames, 5)[0]
    assert w.dominant_expression == "unavailable"
    assert w.expression_valid_ratio == 0.0


def test_multi_window_split() -> None:
    frames = [_frame(i) for i in range(12)]  # 12 seconds at 1 fps
    windows = window_frames(frames, window_seconds=5)
    assert len(windows) == 3
    assert windows[0].n_frames == 5
    assert windows[1].n_frames == 5
    assert windows[2].n_frames == 2
