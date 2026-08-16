"""Face detection, crop, quality flags, and missing-data policy.

Occlusion and blur are flagged, never dropped (v2 §4). No-face frames are
logged as away-from-desk events — themselves a distraction signal.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np

from component3.types import BoundingBox


@dataclass
class PreprocessResult:
    face_present: bool
    face_valid: bool
    away_from_desk: bool
    blurred: bool
    occluded: bool
    detection_score: Optional[float]
    bbox: Optional[BoundingBox]
    face_crop: Optional[np.ndarray]
    gray_crop: Optional[np.ndarray]
    blur_score: Optional[float]


def relative_bbox_to_pixels(
    rel_x: float,
    rel_y: float,
    rel_w: float,
    rel_h: float,
    frame_w: int,
    frame_h: int,
    margin: float,
) -> BoundingBox:
    """Convert a relative bbox to pixel coords with a margin, clipped to the frame."""
    x = rel_x * frame_w
    y = rel_y * frame_h
    w = rel_w * frame_w
    h = rel_h * frame_h
    mx = w * margin
    my = h * margin
    x0 = int(max(0, np.floor(x - mx)))
    y0 = int(max(0, np.floor(y - my)))
    x1 = int(min(frame_w, np.ceil(x + w + mx)))
    y1 = int(min(frame_h, np.ceil(y + h + my)))
    return BoundingBox(x=x0, y=y0, w=max(0, x1 - x0), h=max(0, y1 - y0))


def crop_face(frame: np.ndarray, bbox: BoundingBox, face_size: tuple[int, int]) -> np.ndarray:
    x, y, w, h = bbox.as_tuple()
    crop = frame[y : y + h, x : x + w]
    if crop.size == 0:
        return np.zeros((face_size[1], face_size[0], 3), dtype=np.uint8)
    return cv2.resize(crop, (face_size[0], face_size[1]), interpolation=cv2.INTER_AREA)


def blur_score(gray: np.ndarray) -> float:
    """Laplacian variance — low values mean a blurry crop."""
    if gray.size == 0:
        return 0.0
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def glare_ratio(eye_region: np.ndarray, glare_pixel_value: float) -> float:
    """Fraction of near-saturated pixels in an eye crop (glasses glare heuristic)."""
    if eye_region is None or eye_region.size == 0:
        return 0.0
    gray = eye_region if eye_region.ndim == 2 else cv2.cvtColor(eye_region, cv2.COLOR_BGR2GRAY)
    return float(np.mean(gray >= glare_pixel_value))


class FaceDetector:
    """MediaPipe face-detection wrapper (legacy solutions API or Tasks API).

    Falls back to empty detections if MediaPipe is unavailable.
    """

    def __init__(self, min_confidence: float = 0.5) -> None:
        self.min_confidence = min_confidence
        self._mp = None
        self._detector = None
        self._tasks_detector = None
        try:
            import mediapipe as mp

            self._mp = mp
            if hasattr(mp, "solutions"):
                self._detector = mp.solutions.face_detection.FaceDetection(
                    model_selection=0,
                    min_detection_confidence=min_confidence,
                )
            else:
                self._tasks_detector = self._build_tasks_detector(mp, min_confidence)
        except Exception:
            self._detector = None
            self._tasks_detector = None

    @staticmethod
    def _build_tasks_detector(mp, min_confidence: float):
        from mediapipe.tasks.python.core.base_options import BaseOptions
        from mediapipe.tasks.python import vision

        from component3.mp_models import face_detector_model

        options = vision.FaceDetectorOptions(
            base_options=BaseOptions(
                model_asset_path=str(face_detector_model()),
                delegate=BaseOptions.Delegate.CPU,
            ),
            running_mode=vision.RunningMode.IMAGE,
            min_detection_confidence=min_confidence,
        )
        return vision.FaceDetector.create_from_options(options)

    def detect(self, frame_bgr: np.ndarray) -> tuple[Optional[BoundingBox], Optional[float]]:
        h, w = frame_bgr.shape[:2]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        if self._detector is not None:
            results = self._detector.process(rgb)
            if not results.detections:
                return None, None
            det = results.detections[0]
            score = float(det.score[0]) if det.score else None
            rel = det.location_data.relative_bounding_box
            bbox = relative_bbox_to_pixels(rel.xmin, rel.ymin, rel.width, rel.height, w, h, margin=0.0)
        elif self._tasks_detector is not None:
            mp = self._mp
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            result = self._tasks_detector.detect(image)
            if not result.detections:
                return None, None
            det = result.detections[0]
            score = float(det.categories[0].score) if det.categories else None
            box = det.bounding_box  # pixel coords in Tasks API
            bbox = BoundingBox(
                x=max(0, int(box.origin_x)),
                y=max(0, int(box.origin_y)),
                w=min(w - max(0, int(box.origin_x)), int(box.width)),
                h=min(h - max(0, int(box.origin_y)), int(box.height)),
            )
        else:
            return None, None
        if bbox.w <= 0 or bbox.h <= 0:
            return None, score
        return bbox, score

    def close(self) -> None:
        if self._detector is not None:
            self._detector.close()
            self._detector = None
        if self._tasks_detector is not None:
            self._tasks_detector.close()
            self._tasks_detector = None


def preprocess_frame(
    frame_bgr: np.ndarray,
    cfg: dict[str, Any],
    detector: FaceDetector | None = None,
    bbox: BoundingBox | None = None,
    detection_score: float | None = None,
) -> PreprocessResult:
    """Run face crop + quality flags. Caller may supply a bbox from Face Mesh to skip a second detector."""
    pcfg = cfg["preprocess"]
    face_size = tuple(pcfg["face_size"])
    own_detector = False
    if bbox is None:
        if detector is None:
            detector = FaceDetector(min_confidence=pcfg["face_detection_confidence"])
            own_detector = True
        bbox, detection_score = detector.detect(frame_bgr)
        if own_detector:
            detector.close()

    if bbox is None or bbox.w <= 0 or bbox.h <= 0:
        return PreprocessResult(
            face_present=False,
            face_valid=False,
            away_from_desk=True,
            blurred=False,
            occluded=False,
            detection_score=detection_score,
            bbox=None,
            face_crop=None,
            gray_crop=None,
            blur_score=None,
        )

    # Re-apply configured margin if bbox came from a detector without margin.
    h, w = frame_bgr.shape[:2]
    rel_x, rel_y = bbox.x / w, bbox.y / h
    rel_w, rel_h = bbox.w / w, bbox.h / h
    padded = relative_bbox_to_pixels(rel_x, rel_y, rel_w, rel_h, w, h, margin=pcfg["crop_margin"])
    crop = crop_face(frame_bgr, padded, face_size)
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    bscore = blur_score(gray)
    blurred = bscore < float(pcfg["blur_threshold"])
    occluded = False
    if detection_score is not None:
        occluded = detection_score < float(pcfg["occlusion_score_threshold"])

    face_valid = (not blurred) and (not occluded)
    return PreprocessResult(
        face_present=True,
        face_valid=face_valid,
        away_from_desk=False,
        blurred=blurred,
        occluded=occluded,
        detection_score=detection_score,
        bbox=padded,
        face_crop=crop,
        gray_crop=gray,
        blur_score=bscore,
    )
