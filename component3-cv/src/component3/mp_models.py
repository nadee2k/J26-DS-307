"""Download/cache helpers for MediaPipe Tasks model files.

MediaPipe >= 1.0 removed the legacy `mp.solutions` API; the Tasks API needs
explicit model assets. These are fetched once into artifacts/mediapipe/.
"""

from __future__ import annotations

import urllib.request
from pathlib import Path

from component3.config import PACKAGE_ROOT

MODEL_CACHE = PACKAGE_ROOT / "artifacts" / "mediapipe"

FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/latest/face_landmarker.task"
)
FACE_DETECTOR_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
)


def ensure_model(url: str, filename: str) -> Path:
    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    dest = MODEL_CACHE / filename
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    tmp = dest.with_suffix(dest.suffix + ".part")
    urllib.request.urlretrieve(url, tmp)
    tmp.rename(dest)
    return dest


def face_landmarker_model() -> Path:
    return ensure_model(FACE_LANDMARKER_URL, "face_landmarker.task")


def face_detector_model() -> Path:
    return ensure_model(FACE_DETECTOR_URL, "blaze_face_short_range.tflite")
