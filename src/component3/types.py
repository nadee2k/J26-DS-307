"""Shared dataclasses for frame-level and window-level records."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional


COHORTS = ("screen", "non_screen")
EXPRESSION_CLASSES = ("neutral", "focused", "confused", "bored")
DOMINANT_EXPRESSION = EXPRESSION_CLASSES + ("unavailable",)


@dataclass
class BoundingBox:
    x: int
    y: int
    w: int
    h: int

    def as_tuple(self) -> tuple[int, int, int, int]:
        return self.x, self.y, self.w, self.h


@dataclass
class FrameRecord:
    """One sampled frame after feature extraction. Missing signals are flagged, never silently dropped."""

    session_id: str
    participant_id: str
    cohort: str
    timestamp: str
    frame_index: int
    face_present: bool = False
    face_valid: bool = False
    away_from_desk: bool = True
    blurred: bool = False
    occluded: bool = False
    glare: bool = False
    detection_score: Optional[float] = None
    yaw: Optional[float] = None
    pitch: Optional[float] = None
    roll: Optional[float] = None
    gaze_valid: bool = False
    on_screen: Optional[bool] = None
    iris_offset_x: Optional[float] = None
    iris_offset_y: Optional[float] = None
    gaze_calibrated: bool = False
    phone_present: bool = False
    phone_confidence: float = 0.0
    expression_valid: bool = False
    expression_class: Optional[str] = None
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        extra = d.pop("extra", {}) or {}
        d.update(extra)
        return d


@dataclass
class WindowRecord:
    """Fixed-duration aggregate used as the join key with Components 1/2."""

    session_id: str
    participant_id: str
    cohort: str
    window_start: str
    window_end: str
    n_frames: int
    face_present_ratio: float
    face_valid_ratio: float
    away_from_desk_ratio: float
    blurred_ratio: float
    occluded_ratio: float
    glare_ratio: float
    yaw_mean: Optional[float]
    yaw_std: Optional[float]
    pitch_mean: Optional[float]
    pitch_std: Optional[float]
    roll_mean: Optional[float]
    roll_std: Optional[float]
    gaze_valid_ratio: float
    off_screen_gaze_ratio: Optional[float]
    phone_present_ratio: float
    phone_confidence_max: float
    expression_valid_ratio: float
    dominant_expression: str
    expr_neutral_ratio: float = 0.0
    expr_focused_ratio: float = 0.0
    expr_confused_ratio: float = 0.0
    expr_bored_ratio: float = 0.0
    visual_focus_score: Optional[float] = None
    confidence: Optional[float] = None
    phone_detected: bool = False

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def feature_vector(self) -> dict[str, float]:
        """Numeric features for the ML head. Validity ratios are features in their own right."""
        return {
            "face_present_ratio": self.face_present_ratio,
            "face_valid_ratio": self.face_valid_ratio,
            "away_from_desk_ratio": self.away_from_desk_ratio,
            "blurred_ratio": self.blurred_ratio,
            "occluded_ratio": self.occluded_ratio,
            "glare_ratio": self.glare_ratio,
            "yaw_mean": _nan(self.yaw_mean),
            "yaw_std": _nan(self.yaw_std),
            "pitch_mean": _nan(self.pitch_mean),
            "pitch_std": _nan(self.pitch_std),
            "roll_mean": _nan(self.roll_mean),
            "roll_std": _nan(self.roll_std),
            "gaze_valid_ratio": self.gaze_valid_ratio,
            "off_screen_gaze_ratio": _nan(self.off_screen_gaze_ratio),
            "phone_present_ratio": self.phone_present_ratio,
            "phone_confidence_max": self.phone_confidence_max,
            "expression_valid_ratio": self.expression_valid_ratio,
            "expr_neutral_ratio": self.expr_neutral_ratio,
            "expr_focused_ratio": self.expr_focused_ratio,
            "expr_confused_ratio": self.expr_confused_ratio,
            "expr_bored_ratio": self.expr_bored_ratio,
        }


FEATURE_COLUMNS = [
    "face_present_ratio",
    "face_valid_ratio",
    "away_from_desk_ratio",
    "blurred_ratio",
    "occluded_ratio",
    "glare_ratio",
    "yaw_mean",
    "yaw_std",
    "pitch_mean",
    "pitch_std",
    "roll_mean",
    "roll_std",
    "gaze_valid_ratio",
    "off_screen_gaze_ratio",
    "phone_present_ratio",
    "phone_confidence_max",
    "expression_valid_ratio",
    "expr_neutral_ratio",
    "expr_focused_ratio",
    "expr_confused_ratio",
    "expr_bored_ratio",
]


def _nan(value: Optional[float]) -> float:
    if value is None:
        return float("nan")
    return float(value)
