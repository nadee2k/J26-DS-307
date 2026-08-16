"""Camera-facing services for the web UI: preview, live capture, calibration.

Only one service may own the camera at a time; the app layer enforces this
by stopping the preview before capture/calibration starts.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import cv2
import numpy as np

from component3.capture import run_session
from component3.config import resolve_path
from component3.features.face_pose import FaceMeshEngine, pose_from_mesh
from component3.features.gaze import gaze_feature_vector, iris_offsets
from component3.features.gaze_calibration import fit_calibrator_from_arrays
from component3.scoring import heuristic_focus_score
from component3.types import FrameRecord
from component3.windowing import aggregate_window


def _encode_preview(frame: np.ndarray, width: int = 480) -> bytes:
    h, w = frame.shape[:2]
    scale = width / max(w, 1)
    small = cv2.resize(frame, (width, max(1, int(h * scale))))
    ok, buf = cv2.imencode(".jpg", small, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
    return buf.tobytes() if ok else b""


def _parse_source(source: Any) -> int | str:
    if source is None or source == "":
        return 0
    if isinstance(source, int):
        return source
    s = str(source).strip()
    return int(s) if s.isdigit() else s


class PreviewService:
    """Short-lived camera preview for aiming the rig. Auto-stops when idle."""

    IDLE_TIMEOUT_S = 30.0

    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.preview_jpeg: bytes = b""
        self.last_access = 0.0
        self.error: Optional[str] = None
        self.running = False

    def start(self, source: Any = 0, width: int = 1280, height: int = 720) -> None:
        with self._lock:
            if self.running:
                self.last_access = time.time()
                return
            self._stop.clear()
            self.error = None
            self.running = True
            self.last_access = time.time()
            self._thread = threading.Thread(
                target=self._loop, args=(_parse_source(source), width, height), daemon=True,
            )
            self._thread.start()

    def _loop(self, source: int | str, width: int, height: int) -> None:
        cap = cv2.VideoCapture(source)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        if not cap.isOpened():
            self.error = f"Cannot open camera source {source!r}"
            self.running = False
            return
        try:
            while not self._stop.is_set():
                if time.time() - self.last_access > self.IDLE_TIMEOUT_S:
                    break
                ok, frame = cap.read()
                if not ok:
                    self.error = "Camera stopped producing frames"
                    break
                self.preview_jpeg = _encode_preview(frame)
                time.sleep(0.08)
        finally:
            cap.release()
            self.running = False

    def frame(self) -> bytes:
        self.last_access = time.time()
        return self.preview_jpeg

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=3)
        self.running = False


class CaptureController:
    """Runs run_session() in a thread with live stats and a preview buffer."""

    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._recent: deque[FrameRecord] = deque(maxlen=200)
        self.preview_jpeg: bytes = b""
        self.state: dict[str, Any] = {"phase": "idle"}
        self._cfg: Optional[dict[str, Any]] = None

    @property
    def running(self) -> bool:
        return self.state.get("phase") == "running"

    def start(self, cfg: dict[str, Any], params: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            if self.running:
                raise RuntimeError("A capture session is already running")
            self._stop.clear()
            self._recent.clear()
            self.preview_jpeg = b""
            self._cfg = cfg
            self.state = {
                "phase": "running",
                "participant_id": params["participant_id"],
                "cohort": params["cohort"],
                "started": time.time(),
                "n_frames": 0,
                "last": None,
                "meta": None,
                "error": None,
            }
            self._thread = threading.Thread(target=self._run, args=(cfg, params), daemon=True)
            self._thread.start()
        return self.status()

    def _on_frame(self, rec: FrameRecord, frame: np.ndarray) -> None:
        self._recent.append(rec)
        self.state["n_frames"] = self.state.get("n_frames", 0) + 1
        self.state["last"] = {
            "face_present": rec.face_present,
            "face_valid": rec.face_valid,
            "on_screen": rec.on_screen,
            "gaze_valid": rec.gaze_valid,
            "gaze_calibrated": rec.gaze_calibrated,
            "phone_present": rec.phone_present,
            "phone_confidence": rec.phone_confidence,
            "yaw": rec.yaw,
            "pitch": rec.pitch,
            "roll": rec.roll,
        }
        self.preview_jpeg = _encode_preview(frame)

    def _run(self, cfg: dict[str, Any], params: dict[str, Any]) -> None:
        try:
            meta = run_session(
                cfg,
                params["participant_id"],
                params["cohort"],
                duration_seconds=params.get("duration_seconds"),
                source=_parse_source(params.get("source")),
                retain_frames=bool(params.get("retain_frames", False)) or None
                if params.get("retain_frames")
                else None,
                stub_phone=bool(params.get("stub_phone", False)),
                stop_event=self._stop,
                frame_callback=self._on_frame,
            )
            self.state["meta"] = meta
            self.state["phase"] = "done"
        except Exception as exc:
            self.state["error"] = f"{type(exc).__name__}: {exc}"
            self.state["phase"] = "error"

    def _provisional_score(self) -> Optional[dict[str, float]]:
        if self._cfg is None or not self._recent:
            return None
        window_s = float(self._cfg["windowing"]["window_seconds"])
        now = datetime.now(timezone.utc)
        cutoff = now - timedelta(seconds=window_s)
        frames = [
            r for r in self._recent
            if datetime.fromisoformat(r.timestamp.replace("Z", "+00:00")) >= cutoff
        ]
        if not frames:
            return None
        try:
            window = aggregate_window(frames, cutoff, now)
            score, conf = heuristic_focus_score(window, self._cfg)
            return {"score": score, "confidence": conf, "n_frames": len(frames)}
        except Exception:
            return None

    def stop(self) -> dict[str, Any]:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=30)
        return self.status()

    def status(self) -> dict[str, Any]:
        out = dict(self.state)
        if self.running:
            out["elapsed"] = time.time() - self.state.get("started", time.time())
            out["live_window"] = self._provisional_score()
        return out


CALIBRATION_ONSCREEN_FRACTIONS = [0.12, 0.5, 0.88]


class CalibrationService:
    """Browser-driven gaze calibration: the UI shows dots/prompts, the backend
    samples iris + pose features from its own camera reader thread."""

    def __init__(self) -> None:
        self._cap: Optional[cv2.VideoCapture] = None
        self._engine: Optional[FaceMeshEngine] = None
        self._reader: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._frame_lock = threading.Lock()
        self._latest: Optional[np.ndarray] = None
        self._frame_seq = 0
        self.preview_jpeg: bytes = b""
        self.active = False
        self.participant_id: Optional[str] = None
        self.steps: list[dict[str, Any]] = []
        self.samples_per_step: list[int] = []
        self._X: list[np.ndarray] = []
        self._y: list[int] = []
        self._cfg: Optional[dict[str, Any]] = None
        self.error: Optional[str] = None

    def start(self, cfg: dict[str, Any], participant_id: str, source: Any = None) -> dict[str, Any]:
        if self.active:
            raise RuntimeError("Calibration already in progress")
        src = _parse_source(source if source is not None else cfg["capture"]["device_index"])
        cap = cv2.VideoCapture(src)
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg["capture"]["width"])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg["capture"]["height"])
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open camera source {src!r}")
        engine = FaceMeshEngine(min_confidence=cfg["preprocess"]["face_detection_confidence"])
        if not engine.available:
            cap.release()
            raise RuntimeError("MediaPipe face landmarker unavailable; cannot calibrate")

        steps: list[dict[str, Any]] = []
        for fy in CALIBRATION_ONSCREEN_FRACTIONS:
            for fx in CALIBRATION_ONSCREEN_FRACTIONS:
                steps.append({"kind": "onscreen", "x": fx, "y": fy, "label": 1})
        for prompt in cfg["calibration"]["offscreen_prompts"]:
            steps.append({"kind": "offscreen", "prompt": prompt.replace("_", " "), "label": 0})

        self._cap = cap
        self._engine = engine
        self._cfg = cfg
        self.participant_id = participant_id
        self.steps = steps
        self.samples_per_step = [0] * len(steps)
        self._X = []
        self._y = []
        self.error = None
        self._stop.clear()
        self.active = True
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()
        return self.status()

    def _read_loop(self) -> None:
        while not self._stop.is_set() and self._cap is not None:
            ok, frame = self._cap.read()
            if not ok:
                self.error = "Camera stopped producing frames"
                break
            with self._frame_lock:
                self._latest = frame
                self._frame_seq += 1
            self.preview_jpeg = _encode_preview(frame)
            time.sleep(0.02)

    def collect(self, step_index: int, timeout_s: float = 10.0) -> dict[str, Any]:
        if not self.active or self._cfg is None or self._engine is None:
            raise RuntimeError("Calibration not active")
        if not (0 <= step_index < len(self.steps)):
            raise ValueError("step_index out of range")
        step = self.steps[step_index]
        target = int(self._cfg["calibration"]["frames_per_point"])
        occl = float(self._cfg["preprocess"]["occlusion_score_threshold"])
        collected = 0
        seen_seq = -1
        deadline = time.time() + timeout_s
        while collected < target and time.time() < deadline:
            with self._frame_lock:
                frame = self._latest
                seq = self._frame_seq
            if frame is None or seq == seen_seq:
                time.sleep(0.01)
                continue
            seen_seq = seq
            mesh = self._engine.infer(frame)
            if mesh is None:
                continue
            offsets = iris_offsets(mesh.landmarks_px)
            if offsets is None:
                continue
            h, w = frame.shape[:2]
            pose = pose_from_mesh(mesh, w, h, occl)
            if not pose.valid:
                continue
            self._X.append(gaze_feature_vector(offsets[0], offsets[1], pose))
            self._y.append(int(step["label"]))
            collected += 1
        self.samples_per_step[step_index] += collected
        return {"step": step_index, "collected": collected, "target": target}

    def finish(self) -> dict[str, Any]:
        if not self.active or self._cfg is None:
            raise RuntimeError("Calibration not active")
        try:
            if len(set(self._y)) < 2 or len(self._X) < 20:
                raise RuntimeError(
                    f"Not enough samples (n={len(self._X)}, classes={sorted(set(self._y))}). "
                    "Ensure the face is clearly visible and retry."
                )
            X = np.stack(self._X)
            y = np.array(self._y)
            clf = fit_calibrator_from_arrays(X, y)
            acc = float(clf.score(X, y))
            cal_dir = resolve_path(self._cfg, "calibration_dir")
            cal_dir.mkdir(parents=True, exist_ok=True)
            path = cal_dir / f"{self.participant_id}.joblib"
            import joblib

            joblib.dump(clf, path)
            return {
                "participant_id": self.participant_id,
                "n_samples": int(len(y)),
                "onscreen_samples": int((y == 1).sum()),
                "offscreen_samples": int((y == 0).sum()),
                "train_accuracy": acc,
                "path": str(path),
            }
        finally:
            self.cancel()

    def cancel(self) -> None:
        self._stop.set()
        if self._reader is not None:
            self._reader.join(timeout=3)
        if self._cap is not None:
            self._cap.release()
            self._cap = None
        if self._engine is not None:
            self._engine.close()
            self._engine = None
        self.active = False

    def status(self) -> dict[str, Any]:
        return {
            "active": self.active,
            "participant_id": self.participant_id,
            "steps": self.steps,
            "samples_per_step": self.samples_per_step,
            "total_samples": len(self._X),
            "error": self.error,
        }
