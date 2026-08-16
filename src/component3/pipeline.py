"""In-stream pipeline: one frame → FrameRecord, using a shared Face Mesh pass."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import numpy as np

from component3.features.expression import ExpressionClassifier
from component3.features.face_pose import FaceMeshEngine, pose_from_mesh
from component3.features.gaze import GazeEstimator
from component3.features.phone_detect import PhoneDetector
from component3.preprocess import preprocess_frame
from component3.types import FrameRecord


class VisualPipeline:
    def __init__(
        self,
        cfg: dict[str, Any],
        participant_id: str | None = None,
        stub_phone: bool = False,
    ) -> None:
        self.cfg = cfg
        self.mesh = FaceMeshEngine(min_confidence=cfg["preprocess"]["face_detection_confidence"])
        self.gaze = GazeEstimator(cfg, participant_id=participant_id)
        self.phone = PhoneDetector(cfg, stub=stub_phone)
        self.expression = ExpressionClassifier(cfg)

    def process_frame(
        self,
        frame_bgr: np.ndarray,
        *,
        session_id: str,
        participant_id: str,
        cohort: str,
        frame_index: int,
        timestamp: str | None = None,
    ) -> FrameRecord:
        ts = timestamp or datetime.now(timezone.utc).isoformat()
        h, w = frame_bgr.shape[:2]
        mesh = self.mesh.infer(frame_bgr)
        bbox = mesh.bbox if mesh is not None else None
        score = mesh.mean_visibility if mesh is not None else None
        prep = preprocess_frame(
            frame_bgr, self.cfg, bbox=bbox, detection_score=score,
        )
        pose = None
        if mesh is not None:
            pose = pose_from_mesh(
                mesh, w, h, float(self.cfg["preprocess"]["occlusion_score_threshold"]),
            )
        gaze = self.gaze.estimate(frame_bgr, mesh, pose)
        phone = self.phone.detect(frame_bgr)
        expr = self.expression.predict(prep.face_crop)

        face_present = prep.face_present
        pose_valid = bool(pose.valid) if pose is not None else False
        return FrameRecord(
            session_id=session_id,
            participant_id=participant_id,
            cohort=cohort,
            timestamp=ts,
            frame_index=frame_index,
            face_present=face_present,
            face_valid=prep.face_valid and pose_valid,
            away_from_desk=prep.away_from_desk,
            blurred=prep.blurred,
            occluded=prep.occluded,
            glare=gaze.glare,
            detection_score=prep.detection_score,
            yaw=pose.yaw if pose and pose.valid else None,
            pitch=pose.pitch if pose and pose.valid else None,
            roll=pose.roll if pose and pose.valid else None,
            gaze_valid=gaze.valid,
            on_screen=gaze.on_screen,
            iris_offset_x=gaze.iris_offset_x,
            iris_offset_y=gaze.iris_offset_y,
            gaze_calibrated=gaze.calibrated,
            phone_present=phone.present,
            phone_confidence=phone.confidence,
            expression_valid=expr.valid,
            expression_class=expr.label,
        )

    def close(self) -> None:
        self.mesh.close()
