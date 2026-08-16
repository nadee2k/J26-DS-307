"""Per-participant 9-point on-screen + off-screen gaze calibration.

Calibration is what makes webcam gaze usable at all (v2 §5). This routine
collects iris-offset + head-pose features at known on-screen grid points and
explicit off-screen prompts, then fits a small logistic regression mapping
those features to on_screen ∈ {0, 1}.
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Any

import cv2
import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression

from component3.config import load_config, resolve_path
from component3.features.face_pose import FaceMeshEngine, pose_from_mesh
from component3.features.gaze import GazeEstimator, gaze_feature_vector, iris_offsets


ONSCREEN_LABELS = [
    "look at TOP-LEFT",
    "look at TOP-CENTER",
    "look at TOP-RIGHT",
    "look at MID-LEFT",
    "look at CENTER",
    "look at MID-RIGHT",
    "look at BOTTOM-LEFT",
    "look at BOTTOM-CENTER",
    "look at BOTTOM-RIGHT",
]


def _grid_points(cols: int, rows: int, width: int, height: int) -> list[tuple[int, int]]:
    xs = np.linspace(0.12, 0.88, cols)
    ys = np.linspace(0.12, 0.88, rows)
    points = []
    for y in ys:
        for x in xs:
            points.append((int(x * width), int(y * height)))
    return points


def _collect_samples(
    cap: cv2.VideoCapture,
    engine: FaceMeshEngine,
    cfg: dict[str, Any],
    n_frames: int,
    prompt: str,
    draw_point: tuple[int, int] | None,
    window_name: str,
) -> list[np.ndarray]:
    samples: list[np.ndarray] = []
    while len(samples) < n_frames:
        ok, frame = cap.read()
        if not ok:
            break
        display = frame.copy()
        if draw_point is not None:
            cv2.circle(display, draw_point, 18, (0, 255, 0), -1)
            cv2.circle(display, draw_point, 28, (255, 255, 255), 2)
        cv2.putText(
            display, prompt, (40, 60),
            cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2, cv2.LINE_AA,
        )
        cv2.putText(
            display, f"samples {len(samples)}/{n_frames}  (q to abort)",
            (40, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (200, 200, 200), 2, cv2.LINE_AA,
        )
        cv2.imshow(window_name, display)
        key = cv2.waitKey(1) & 0xFF
        if key == ord("q"):
            break
        mesh = engine.infer(frame)
        if mesh is None:
            continue
        offsets = iris_offsets(mesh.landmarks_px)
        if offsets is None:
            continue
        h, w = frame.shape[:2]
        pose = pose_from_mesh(mesh, w, h, float(cfg["preprocess"]["occlusion_score_threshold"]))
        if not pose.valid:
            continue
        samples.append(gaze_feature_vector(offsets[0], offsets[1], pose))
        time.sleep(0.03)
    return samples


def run_calibration(participant_id: str, cfg: dict[str, Any] | None = None, device_index: int | None = None) -> Path:
    cfg = cfg or load_config()
    device = cfg["capture"]["device_index"] if device_index is None else device_index
    cap = cv2.VideoCapture(device)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, cfg["capture"]["width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, cfg["capture"]["height"])
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open camera device {device}")

    window = "FocusTrack gaze calibration"
    cv2.namedWindow(window, cv2.WINDOW_NORMAL)
    cv2.setWindowProperty(window, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
    # Probe size
    ok, probe = cap.read()
    if not ok:
        cap.release()
        raise RuntimeError("Camera produced no frames")
    h, w = probe.shape[:2]
    grid = int(cfg["calibration"]["onscreen_grid"])
    points = _grid_points(grid, grid, w, h)
    n_frames = int(cfg["calibration"]["frames_per_point"])

    engine = FaceMeshEngine(min_confidence=cfg["preprocess"]["face_detection_confidence"])
    if not engine.available:
        cap.release()
        cv2.destroyAllWindows()
        raise RuntimeError("MediaPipe Face Mesh is unavailable; cannot calibrate")

    X: list[np.ndarray] = []
    y: list[int] = []
    try:
        for label, point in zip(ONSCREEN_LABELS, points):
            samples = _collect_samples(cap, engine, cfg, n_frames, label, point, window)
            X.extend(samples)
            y.extend([1] * len(samples))
        for prompt in cfg["calibration"]["offscreen_prompts"]:
            human = prompt.replace("_", " ").upper()
            samples = _collect_samples(
                cap, engine, cfg, n_frames, f"OFF-SCREEN: {human}", None, window,
            )
            X.extend(samples)
            y.extend([0] * len(samples))
    finally:
        engine.close()
        cap.release()
        cv2.destroyAllWindows()

    if len(set(y)) < 2 or len(X) < 20:
        raise RuntimeError(
            f"Not enough calibration samples (n={len(X)}, classes={set(y)}). Retry with a clearer view of the face."
        )

    clf = LogisticRegression(max_iter=500, class_weight="balanced")
    clf.fit(np.stack(X), np.array(y))
    cal_dir = resolve_path(cfg, "calibration_dir")
    cal_dir.mkdir(parents=True, exist_ok=True)
    out = cal_dir / f"{participant_id}.joblib"
    joblib.dump(clf, out)
    return out


def fit_calibrator_from_arrays(X: np.ndarray, y: np.ndarray) -> LogisticRegression:
    """Headless helper used by tests and synthetic pipelines."""
    clf = LogisticRegression(max_iter=500, class_weight="balanced")
    clf.fit(X, y)
    return clf


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Per-participant 9-point gaze calibration")
    parser.add_argument("--participant-id", required=True)
    parser.add_argument("--config", default=None)
    parser.add_argument("--device", type=int, default=None)
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    path = run_calibration(args.participant_id, cfg=cfg, device_index=args.device)
    print(f"Saved calibrator to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
