"""Coarse on/off-screen gaze from iris landmarks + optional per-user calibration.

MediaPipe Iris / Face Mesh refine_landmarks provides iris *landmarks* and can
estimate camera distance; it does **not** infer gaze direction (v2 §5). This
module maps iris offset + head pose to a binary on_screen label, using a
per-participant calibrator when available and a documented heuristic otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np

from component3.features.face_pose import (
    LEFT_EYE,
    LEFT_IRIS_CENTER,
    RIGHT_EYE,
    RIGHT_IRIS_CENTER,
    HeadPose,
    MeshResult,
)
from component3.preprocess import glare_ratio


@dataclass
class GazeResult:
    on_screen: Optional[bool]
    valid: bool
    calibrated: bool
    iris_offset_x: Optional[float]
    iris_offset_y: Optional[float]
    glare: bool


def _eye_center_and_size(landmarks_px: np.ndarray, eye: dict[str, int]) -> tuple[np.ndarray, float, float]:
    outer = landmarks_px[eye["outer"]]
    inner = landmarks_px[eye["inner"]]
    top = landmarks_px[eye["top"]]
    bottom = landmarks_px[eye["bottom"]]
    center = (outer + inner) / 2.0
    width = float(np.linalg.norm(outer - inner) + 1e-6)
    height = float(np.linalg.norm(top - bottom) + 1e-6)
    return center, width, height


def iris_offsets(landmarks_px: np.ndarray) -> Optional[tuple[float, float]]:
    """Normalized iris offset averaged across both eyes. None if iris landmarks are missing."""
    n = landmarks_px.shape[0]
    if n <= max(LEFT_IRIS_CENTER, RIGHT_IRIS_CENTER):
        return None
    offsets = []
    for iris_idx, eye in ((LEFT_IRIS_CENTER, LEFT_EYE), (RIGHT_IRIS_CENTER, RIGHT_EYE)):
        center, width, height = _eye_center_and_size(landmarks_px, eye)
        iris = landmarks_px[iris_idx]
        ox = float((iris[0] - center[0]) / width)
        oy = float((iris[1] - center[1]) / height)
        offsets.append((ox, oy))
    mx = float(np.mean([o[0] for o in offsets]))
    my = float(np.mean([o[1] for o in offsets]))
    return mx, my


def eye_crop(frame_bgr: np.ndarray, landmarks_px: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """Combined left+right eye crop used for glare detection and optional CNN input."""
    n = landmarks_px.shape[0]
    needed = [LEFT_EYE["outer"], LEFT_EYE["inner"], RIGHT_EYE["outer"], RIGHT_EYE["inner"]]
    if n <= max(needed):
        return np.zeros((size[1], size[0], 3), dtype=np.uint8)
    xs = np.concatenate(
        [
            landmarks_px[[LEFT_EYE["outer"], LEFT_EYE["inner"], LEFT_EYE["top"], LEFT_EYE["bottom"]]],
            landmarks_px[[RIGHT_EYE["outer"], RIGHT_EYE["inner"], RIGHT_EYE["top"], RIGHT_EYE["bottom"]]],
        ]
    )
    h, w = frame_bgr.shape[:2]
    x0 = int(max(0, xs[:, 0].min() - 8))
    y0 = int(max(0, xs[:, 1].min() - 8))
    x1 = int(min(w, xs[:, 0].max() + 8))
    y1 = int(min(h, xs[:, 1].max() + 8))
    crop = frame_bgr[y0:y1, x0:x1]
    if crop.size == 0:
        return np.zeros((size[1], size[0], 3), dtype=np.uint8)
    return cv2.resize(crop, (size[0], size[1]), interpolation=cv2.INTER_AREA)


def heuristic_on_screen(
    iris_offset_x: float,
    iris_offset_y: float,
    yaw: Optional[float],
    cfg: dict[str, Any],
) -> bool:
    gcfg = cfg["gaze"]
    offset_ok = (
        abs(iris_offset_x) < float(gcfg["heuristic_iris_offset_threshold"])
        and abs(iris_offset_y) < float(gcfg["heuristic_iris_offset_threshold"])
    )
    yaw_ok = True
    if yaw is not None:
        yaw_ok = abs(yaw) < float(gcfg["heuristic_yaw_threshold_deg"])
    return bool(offset_ok and yaw_ok)


def gaze_feature_vector(
    iris_offset_x: float,
    iris_offset_y: float,
    pose: Optional[HeadPose],
) -> np.ndarray:
    yaw = pose.yaw if pose is not None else 0.0
    pitch = pose.pitch if pose is not None else 0.0
    roll = pose.roll if pose is not None else 0.0
    return np.array([iris_offset_x, iris_offset_y, yaw, pitch, roll], dtype=np.float32)


class GazeEstimator:
    """Runtime gaze classifier. Loads a per-participant joblib calibrator if present."""

    def __init__(self, cfg: dict[str, Any], participant_id: str | None = None) -> None:
        self.cfg = cfg
        self.participant_id = participant_id
        self.calibrator = None
        if participant_id:
            self.calibrator = _load_calibrator(cfg, participant_id)

    def estimate(
        self,
        frame_bgr: np.ndarray,
        mesh: Optional[MeshResult],
        pose: Optional[HeadPose],
    ) -> GazeResult:
        if mesh is None:
            return GazeResult(
                on_screen=None, valid=False, calibrated=False,
                iris_offset_x=None, iris_offset_y=None, glare=False,
            )
        offsets = iris_offsets(mesh.landmarks_px)
        if offsets is None:
            return GazeResult(
                on_screen=None, valid=False, calibrated=False,
                iris_offset_x=None, iris_offset_y=None, glare=False,
            )
        ox, oy = offsets
        crop = eye_crop(frame_bgr, mesh.landmarks_px, tuple(self.cfg["gaze"]["eye_crop_size"]))
        g_ratio = glare_ratio(crop, float(self.cfg["preprocess"]["glare_pixel_value"]))
        glare = g_ratio >= float(self.cfg["preprocess"]["glare_ratio_threshold"])
        if glare:
            return GazeResult(
                on_screen=None, valid=False, calibrated=self.calibrator is not None,
                iris_offset_x=ox, iris_offset_y=oy, glare=True,
            )
        if self.calibrator is not None:
            feats = gaze_feature_vector(ox, oy, pose).reshape(1, -1)
            pred = int(self.calibrator.predict(feats)[0])
            return GazeResult(
                on_screen=bool(pred), valid=True, calibrated=True,
                iris_offset_x=ox, iris_offset_y=oy, glare=False,
            )
        on_screen = heuristic_on_screen(ox, oy, pose.yaw if pose else None, self.cfg)
        return GazeResult(
            on_screen=on_screen, valid=True, calibrated=False,
            iris_offset_x=ox, iris_offset_y=oy, glare=False,
        )


def _load_calibrator(cfg: dict[str, Any], participant_id: str):
    from component3.config import resolve_path

    cal_dir = resolve_path(cfg, "calibration_dir")
    path = cal_dir / f"{participant_id}.joblib"
    if not path.exists():
        return None
    import joblib

    return joblib.load(path)
