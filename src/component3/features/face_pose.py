"""Face Mesh + solvePnP head-pose estimation.

Emits yaw/pitch/roll in degrees plus a validity flag. Occluded / low-confidence
meshes are flagged rather than emitting an unreliable pose (v2 §5).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import cv2
import numpy as np

from component3.types import BoundingBox

# Canonical 6-point 3D face model (millimetres), nose-tip origin.
# Expressed in OpenCV camera convention (+X right, +Y down, +Z into scene),
# i.e. the classical "+Y up" model rotated 180 degrees about X, so a frontal
# face yields near-zero yaw/pitch/roll instead of a spurious 180-degree roll.
FACE_3D_MODEL = np.array(
    [
        [0.0, 0.0, 0.0],  # nose tip
        [0.0, 63.6, 12.5],  # chin
        [-43.3, -32.7, 26.0],  # left eye outer
        [43.3, -32.7, 26.0],  # right eye outer
        [-28.9, 28.9, 24.1],  # left mouth
        [28.9, 28.9, 24.1],  # right mouth
    ],
    dtype=np.float64,
)

# MediaPipe Face Mesh landmark indices matching FACE_3D_MODEL.
MESH_POSE_INDICES = (1, 152, 33, 263, 61, 291)

# Iris / eye landmarks (refine_landmarks=True).
LEFT_IRIS_CENTER = 468
RIGHT_IRIS_CENTER = 473
LEFT_EYE = {"outer": 33, "inner": 133, "top": 159, "bottom": 145}
RIGHT_EYE = {"outer": 263, "inner": 362, "top": 386, "bottom": 374}


@dataclass
class MeshResult:
    landmarks_px: np.ndarray  # (n, 2)
    landmarks_norm: np.ndarray  # (n, 3) x,y,z
    bbox: BoundingBox
    mean_visibility: float


@dataclass
class HeadPose:
    yaw: float
    pitch: float
    roll: float
    valid: bool


def camera_matrix(frame_w: int, frame_h: int) -> np.ndarray:
    f = float(frame_w)
    cx, cy = frame_w / 2.0, frame_h / 2.0
    return np.array([[f, 0.0, cx], [0.0, f, cy], [0.0, 0.0, 1.0]], dtype=np.float64)


def rotation_to_euler_deg(rvec: np.ndarray) -> tuple[float, float, float]:
    """Convert Rodrigues rotation vector to (yaw, pitch, roll) in degrees.

    ZYX decomposition in OpenCV camera coords (+X right, +Y down, +Z forward):
    yaw = head turn left/right (about Y), pitch = nod up/down (about X),
    roll = sideways tilt (in-plane, about Z).
    """
    rot, _ = cv2.Rodrigues(rvec)
    sy = float(np.sqrt(rot[0, 0] ** 2 + rot[1, 0] ** 2))
    if sy < 1e-6:
        yaw = float(np.degrees(np.arctan2(-rot[2, 0], sy)))
        pitch = float(np.degrees(np.arctan2(-rot[1, 2], rot[1, 1])))
        roll = 0.0
    else:
        yaw = float(np.degrees(np.arctan2(-rot[2, 0], sy)))
        pitch = float(np.degrees(np.arctan2(rot[2, 1], rot[2, 2])))
        roll = float(np.degrees(np.arctan2(rot[1, 0], rot[0, 0])))
    return yaw, pitch, roll


def estimate_head_pose(
    landmarks_px: np.ndarray,
    frame_w: int,
    frame_h: int,
    indices: tuple[int, ...] = MESH_POSE_INDICES,
) -> HeadPose:
    if landmarks_px.shape[0] <= max(indices):
        return HeadPose(yaw=0.0, pitch=0.0, roll=0.0, valid=False)
    image_points = np.array([landmarks_px[i] for i in indices], dtype=np.float64)
    cam = camera_matrix(frame_w, frame_h)
    dist = np.zeros((4, 1), dtype=np.float64)
    ok, rvec, _tvec = cv2.solvePnP(
        FACE_3D_MODEL,
        image_points,
        cam,
        dist,
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok:
        return HeadPose(yaw=0.0, pitch=0.0, roll=0.0, valid=False)
    yaw, pitch, roll = rotation_to_euler_deg(rvec)
    return HeadPose(yaw=yaw, pitch=pitch, roll=roll, valid=True)


def landmarks_to_bbox(landmarks_px: np.ndarray, frame_w: int, frame_h: int) -> BoundingBox:
    xs = landmarks_px[:, 0]
    ys = landmarks_px[:, 1]
    x0 = int(max(0, np.floor(xs.min())))
    y0 = int(max(0, np.floor(ys.min())))
    x1 = int(min(frame_w, np.ceil(xs.max())))
    y1 = int(min(frame_h, np.ceil(ys.max())))
    return BoundingBox(x=x0, y=y0, w=max(0, x1 - x0), h=max(0, y1 - y0))


class FaceMeshEngine:
    """Owns a MediaPipe face-landmark graph (478 landmarks incl. iris).

    Supports both the legacy `mp.solutions.face_mesh` API (mediapipe < 1.0)
    and the Tasks `FaceLandmarker` API (mediapipe >= 1.0). Degrades to
    unavailable if neither can be constructed (tests without models/network).
    """

    def __init__(self, min_confidence: float = 0.5) -> None:
        self.min_confidence = min_confidence
        self._mesh = None
        self._landmarker = None
        self._mp = None
        try:
            import mediapipe as mp

            self._mp = mp
            if hasattr(mp, "solutions"):
                self._mesh = mp.solutions.face_mesh.FaceMesh(
                    static_image_mode=False,
                    max_num_faces=1,
                    refine_landmarks=True,
                    min_detection_confidence=min_confidence,
                    min_tracking_confidence=min_confidence,
                )
            else:
                self._landmarker = self._build_tasks_landmarker(mp, min_confidence)
        except Exception:
            self._mesh = None
            self._landmarker = None

    @staticmethod
    def _build_tasks_landmarker(mp, min_confidence: float):
        from mediapipe.tasks.python.core.base_options import BaseOptions
        from mediapipe.tasks.python import vision

        from component3.mp_models import face_landmarker_model

        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(
                model_asset_path=str(face_landmarker_model()),
                delegate=BaseOptions.Delegate.CPU,
            ),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=min_confidence,
            min_face_presence_confidence=min_confidence,
        )
        return vision.FaceLandmarker.create_from_options(options)

    @property
    def available(self) -> bool:
        return self._mesh is not None or self._landmarker is not None

    def infer(self, frame_bgr: np.ndarray) -> Optional[MeshResult]:
        if not self.available:
            return None
        h, w = frame_bgr.shape[:2]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
        if self._mesh is not None:
            results = self._mesh.process(rgb)
            if not results.multi_face_landmarks:
                return None
            face = results.multi_face_landmarks[0].landmark
        else:
            mp = self._mp
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            result = self._landmarker.detect(image)
            if not result.face_landmarks:
                return None
            face = result.face_landmarks[0]
        pts_norm = np.array([[lm.x, lm.y, lm.z] for lm in face], dtype=np.float64)
        pts_px = np.stack([pts_norm[:, 0] * w, pts_norm[:, 1] * h], axis=1)
        vis = []
        for lm in face:
            v = getattr(lm, "visibility", None)
            if v is None or v == 0.0:
                v = getattr(lm, "presence", None)
            vis.append(v if v not in (None, 0.0) else 1.0)
        mean_vis = float(np.mean(vis)) if vis else 1.0
        bbox = landmarks_to_bbox(pts_px, w, h)
        return MeshResult(
            landmarks_px=pts_px,
            landmarks_norm=pts_norm,
            bbox=bbox,
            mean_visibility=mean_vis,
        )

    def close(self) -> None:
        if self._mesh is not None:
            self._mesh.close()
            self._mesh = None
        if self._landmarker is not None:
            self._landmarker.close()
            self._landmarker = None


def pose_from_mesh(
    mesh: MeshResult,
    frame_w: int,
    frame_h: int,
    occlusion_threshold: float,
) -> HeadPose:
    pose = estimate_head_pose(mesh.landmarks_px, frame_w, frame_h)
    if mesh.mean_visibility < occlusion_threshold:
        pose.valid = False
    return pose
