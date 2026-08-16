"""Head-pose math without requiring MediaPipe."""

from __future__ import annotations

import numpy as np

from component3.features.face_pose import (
    MESH_POSE_INDICES,
    camera_matrix,
    estimate_head_pose,
    landmarks_to_bbox,
    rotation_to_euler_deg,
)


def test_identity_rotation_near_zero() -> None:
    yaw, pitch, roll = rotation_to_euler_deg(np.zeros((3, 1), dtype=np.float64))
    assert abs(yaw) < 1e-6
    assert abs(pitch) < 1e-6
    assert abs(roll) < 1e-6


def test_camera_matrix_principal_point() -> None:
    k = camera_matrix(1280, 720)
    assert k[0, 2] == 640
    assert k[1, 2] == 360
    assert k[0, 0] == 1280


def test_estimate_head_pose_on_frontal_landmarks() -> None:
    lm = np.zeros((300, 2), dtype=np.float64)
    # Rough frontal face in a 640x480 frame
    lm[1] = [320, 240]    # nose
    lm[152] = [320, 360]  # chin
    lm[33] = [250, 200]   # left eye outer
    lm[263] = [390, 200]  # right eye outer
    lm[61] = [270, 300]   # left mouth
    lm[291] = [370, 300]  # right mouth
    pose = estimate_head_pose(lm, 640, 480, MESH_POSE_INDICES)
    assert pose.valid is True
    assert abs(pose.yaw) < 45
    assert abs(pose.pitch) < 45


def test_landmarks_to_bbox() -> None:
    pts = np.array([[10.2, 20.8], [40.0, 80.1]], dtype=np.float64)
    box = landmarks_to_bbox(pts, 100, 100)
    assert box.x == 10
    assert box.y == 20
    assert box.w == 30
    assert box.h == 61
