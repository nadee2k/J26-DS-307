"""Preprocess: crop math, blur flag, missing-face policy."""

from __future__ import annotations

import cv2
import numpy as np

from component3.preprocess import (
    blur_score,
    crop_face,
    glare_ratio,
    preprocess_frame,
    relative_bbox_to_pixels,
)
from component3.types import BoundingBox


def test_relative_bbox_margin_and_clip() -> None:
    bbox = relative_bbox_to_pixels(0.0, 0.0, 0.2, 0.2, 100, 100, margin=0.25)
    assert bbox.x == 0 and bbox.y == 0
    assert bbox.w > 20 and bbox.h > 20
    inner = relative_bbox_to_pixels(0.4, 0.4, 0.2, 0.2, 100, 100, margin=0.0)
    assert inner.x == 40 and inner.w == 20


def test_blur_score_sharp_vs_blurred() -> None:
    sharp = np.zeros((64, 64), dtype=np.uint8)
    sharp[::2, :] = 255
    blurred = cv2.GaussianBlur(sharp, (15, 15), 5)
    assert blur_score(sharp) > blur_score(blurred)


def test_no_face_is_away_from_desk(cfg: dict) -> None:
    frame = np.zeros((240, 320, 3), dtype=np.uint8)
    result = preprocess_frame(frame, cfg, bbox=None, detection_score=None)
    assert result.face_present is False
    assert result.face_valid is False
    assert result.away_from_desk is True
    assert result.face_crop is None


def test_flags_not_drops_on_blur_and_occlusion(cfg: dict) -> None:
    frame = np.full((240, 320, 3), 30, dtype=np.uint8)
    bbox = BoundingBox(x=40, y=40, w=80, h=80)
    # Uniform crop → very low Laplacian variance → blurred
    result = preprocess_frame(frame, cfg, bbox=bbox, detection_score=0.4)
    assert result.face_present is True
    assert result.blurred is True
    assert result.occluded is True  # 0.4 < 0.60 threshold
    assert result.face_valid is False  # flagged, but crop is still returned
    assert result.face_crop is not None
    assert result.face_crop.shape[0] == cfg["preprocess"]["face_size"][1]


def test_crop_resize() -> None:
    frame = np.zeros((100, 100, 3), dtype=np.uint8)
    crop = crop_face(frame, BoundingBox(10, 10, 20, 20), (32, 32))
    assert crop.shape == (32, 32, 3)


def test_glare_ratio() -> None:
    dark = np.zeros((20, 40), dtype=np.uint8)
    bright = np.full((20, 40), 255, dtype=np.uint8)
    assert glare_ratio(dark, 240) == 0.0
    assert glare_ratio(bright, 240) == 1.0
