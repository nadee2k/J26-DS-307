"""Real-time throughput check: capture → extractors → windowing on this machine.

Validates or corrects the 2–5 fps design before data collection (v2 §9).
"""

from __future__ import annotations

import argparse
import json
import time
from typing import Any

import numpy as np

from component3.config import load_config, resolve_path
from component3.pipeline import VisualPipeline
from component3.windowing import window_frames


def synthetic_frame(width: int, height: int, seed: int = 0) -> np.ndarray:
    rng = np.random.RandomState(seed)
    frame = rng.randint(0, 40, (height, width, 3), dtype=np.uint8)
    # Rough skin-toned rectangle so Face Mesh has something to look at (often still fails;
    # that is fine — we are timing the full pass, including no-face paths).
    x0, y0 = width // 3, height // 4
    frame[y0 : y0 + height // 2, x0 : x0 + width // 3] = (90, 140, 190)
    return frame


def run_benchmark(
    cfg: dict[str, Any],
    n_frames: int = 60,
    stub_phone: bool = True,
    use_camera: bool = False,
) -> dict[str, Any]:
    width = int(cfg["capture"]["width"])
    height = int(cfg["capture"]["height"])
    pipeline = VisualPipeline(cfg, participant_id=None, stub_phone=stub_phone)
    frames = []
    if use_camera:
        import cv2

        cap = cv2.VideoCapture(cfg["capture"]["device_index"])
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
        grabbed = 0
        while grabbed < n_frames:
            ok, frame = cap.read()
            if not ok:
                break
            if frame.shape[1] != width or frame.shape[0] != height:
                frame = cv2.resize(frame, (width, height))
            frames.append(frame)
            grabbed += 1
        cap.release()
        if not frames:
            frames = [synthetic_frame(width, height, i) for i in range(n_frames)]
            use_camera = False
    else:
        frames = [synthetic_frame(width, height, i) for i in range(n_frames)]

    t0 = time.perf_counter()
    records = []
    per_ms = []
    try:
        for i, frame in enumerate(frames):
            t1 = time.perf_counter()
            rec = pipeline.process_frame(
                frame,
                session_id="bench",
                participant_id="bench",
                cohort="screen",
                frame_index=i,
            )
            per_ms.append((time.perf_counter() - t1) * 1000.0)
            records.append(rec)
    finally:
        pipeline.close()
    elapsed = time.perf_counter() - t0
    t_win = time.perf_counter()
    _windows = window_frames(records, float(cfg["windowing"]["window_seconds"]))
    window_ms = (time.perf_counter() - t_win) * 1000.0

    n = max(len(per_ms), 1)
    mean_ms = float(np.mean(per_ms))
    p95_ms = float(np.percentile(per_ms, 95))
    max_fps = 1000.0 / max(mean_ms, 1e-6)
    target = float(cfg["capture"]["target_fps"])
    payload = {
        "n_frames": len(records),
        "source": "camera" if use_camera else "synthetic",
        "stub_phone": stub_phone,
        "mean_frame_ms": mean_ms,
        "p95_frame_ms": p95_ms,
        "max_sustainable_fps": max_fps,
        "target_fps": target,
        "meets_target": max_fps >= target,
        "total_elapsed_s": elapsed,
        "windowing_ms": window_ms,
        "face_present_rate": float(np.mean([r.face_present for r in records])),
        "recommendation": (
            "Target fps is feasible on this machine."
            if max_fps >= target
            else f"Drop target_fps toward {max(1, int(max_fps))} or stub/skip expression+YOLO on CPU."
        ),
    }
    reports = resolve_path(cfg, "reports_dir")
    reports.mkdir(parents=True, exist_ok=True)
    (reports / "benchmark.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Component 3 real-time benchmark")
    parser.add_argument("--config", default=None)
    parser.add_argument("--n-frames", type=int, default=60)
    parser.add_argument("--camera", action="store_true")
    parser.add_argument("--load-yolo", action="store_true", help="Include YOLO in the timed pass")
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    payload = run_benchmark(
        cfg,
        n_frames=args.n_frames,
        stub_phone=not args.load_yolo,
        use_camera=args.camera,
    )
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
