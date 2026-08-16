"""Frame records → fixed windows with validity-ratio features (v2 §4, §6).

Ratios that depend on a signal (e.g. off_screen_gaze_ratio) are computed over
*valid* frames for that signal, not over all frames.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

import numpy as np

from component3.types import FrameRecord, WindowRecord


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _mean_std(values: list[float]) -> tuple[Optional[float], Optional[float]]:
    if not values:
        return None, None
    arr = np.asarray(values, dtype=np.float64)
    return float(arr.mean()), float(arr.std(ddof=0))


def aggregate_window(frames: list[FrameRecord], window_start: datetime, window_end: datetime) -> WindowRecord:
    n = len(frames)
    if n == 0:
        raise ValueError("Cannot aggregate an empty window")
    head = frames[0]
    face_present = sum(1 for f in frames if f.face_present)
    face_valid = sum(1 for f in frames if f.face_valid)
    away = sum(1 for f in frames if f.away_from_desk)
    blurred = sum(1 for f in frames if f.blurred)
    occluded = sum(1 for f in frames if f.occluded)
    glare = sum(1 for f in frames if f.glare)

    yaw = [f.yaw for f in frames if f.yaw is not None and f.face_valid]
    pitch = [f.pitch for f in frames if f.pitch is not None and f.face_valid]
    roll = [f.roll for f in frames if f.roll is not None and f.face_valid]
    yaw_mean, yaw_std = _mean_std(yaw)
    pitch_mean, pitch_std = _mean_std(pitch)
    roll_mean, roll_std = _mean_std(roll)

    gaze_valid_frames = [f for f in frames if f.gaze_valid]
    n_gaze = len(gaze_valid_frames)
    off_screen = None
    if n_gaze > 0:
        off_n = sum(1 for f in gaze_valid_frames if f.on_screen is False)
        off_screen = off_n / n_gaze

    phone_present = sum(1 for f in frames if f.phone_present)
    phone_conf = max((f.phone_confidence for f in frames), default=0.0)

    expr_valid_frames = [f for f in frames if f.expression_valid and f.expression_class]
    n_expr = len(expr_valid_frames)
    counts: Counter[str] = Counter(f.expression_class for f in expr_valid_frames if f.expression_class)
    expr_ratios = {
        "neutral": counts.get("neutral", 0) / n_expr if n_expr else 0.0,
        "focused": counts.get("focused", 0) / n_expr if n_expr else 0.0,
        "confused": counts.get("confused", 0) / n_expr if n_expr else 0.0,
        "bored": counts.get("bored", 0) / n_expr if n_expr else 0.0,
    }
    if n_expr:
        dominant = counts.most_common(1)[0][0]
    else:
        dominant = "unavailable"

    return WindowRecord(
        session_id=head.session_id,
        participant_id=head.participant_id,
        cohort=head.cohort,
        window_start=_iso(window_start),
        window_end=_iso(window_end),
        n_frames=n,
        face_present_ratio=face_present / n,
        face_valid_ratio=face_valid / n,
        away_from_desk_ratio=away / n,
        blurred_ratio=blurred / n,
        occluded_ratio=occluded / n,
        glare_ratio=glare / n,
        yaw_mean=yaw_mean,
        yaw_std=yaw_std,
        pitch_mean=pitch_mean,
        pitch_std=pitch_std,
        roll_mean=roll_mean,
        roll_std=roll_std,
        gaze_valid_ratio=n_gaze / n,
        off_screen_gaze_ratio=off_screen,
        phone_present_ratio=phone_present / n,
        phone_confidence_max=float(phone_conf),
        expression_valid_ratio=n_expr / n,
        dominant_expression=dominant,
        expr_neutral_ratio=expr_ratios["neutral"],
        expr_focused_ratio=expr_ratios["focused"],
        expr_confused_ratio=expr_ratios["confused"],
        expr_bored_ratio=expr_ratios["bored"],
        phone_detected=phone_present > 0,
    )


def window_frames(records: Iterable[FrameRecord], window_seconds: float) -> list[WindowRecord]:
    records = sorted(records, key=lambda r: (_parse_ts(r.timestamp), r.frame_index))
    if not records:
        return []
    windows: list[WindowRecord] = []
    start = _parse_ts(records[0].timestamp)
    delta = timedelta(seconds=window_seconds)
    bucket: list[FrameRecord] = []
    bucket_start = start
    bucket_end = start + delta
    for rec in records:
        ts = _parse_ts(rec.timestamp)
        while ts >= bucket_end:
            if bucket:
                windows.append(aggregate_window(bucket, bucket_start, bucket_end))
            bucket = []
            bucket_start = bucket_end
            bucket_end = bucket_start + delta
        bucket.append(rec)
    if bucket:
        windows.append(aggregate_window(bucket, bucket_start, bucket_end))
    return windows
