"""Session recorder: frame sampler, consent gate, privacy-preserving default.

Default mode pipes frames into the extractor and discards them. Raw JPEGs are
written only when retain_frames is explicitly enabled (debug / model iteration).
"""

from __future__ import annotations

import argparse
import csv
import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

import cv2
import numpy as np
import pandas as pd

from component3.config import load_config, resolve_path
from component3.export_schema import windows_to_contract, write_session_export
from component3.pipeline import VisualPipeline
from component3.scoring import score_window
from component3.types import COHORTS, FrameRecord
from component3.windowing import window_frames


class ConsentError(RuntimeError):
    pass


def load_consent_ids(consent_file: Path) -> set[str]:
    if not consent_file.exists():
        return set()
    ids: set[str] = set()
    with open(consent_file, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            pid = (row.get("participant_id") or "").strip()
            flag = (row.get("consented") or "").strip().lower()
            if pid and flag in {"true", "1", "yes", "y"}:
                ids.add(pid)
    return ids


def assert_consented(cfg: dict[str, Any], participant_id: str) -> None:
    consent_file = resolve_path(cfg, "consent_file")
    allowed = load_consent_ids(consent_file)
    if participant_id not in allowed:
        raise ConsentError(
            f"No consent record for '{participant_id}' in {consent_file}. "
            "Capture refuses to start until informed consent is on file."
        )


def make_session_id(participant_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    return f"c3-{participant_id}-{stamp}-{uuid.uuid4().hex[:6]}"


def iter_frames(
    source: int | str,
    width: int,
    height: int,
    target_fps: float,
) -> Iterator[tuple[int, np.ndarray, str]]:
    """Yield (index, frame, iso_timestamp) at approximately target_fps.

    `source` is a camera index, video path, or image-directory path.
    """
    src_path = Path(str(source)) if not isinstance(source, int) else None
    if src_path is not None and src_path.is_dir():
        images = sorted(
            p for p in src_path.iterdir()
            if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp"}
        )
        interval = 1.0 / max(target_fps, 1e-6)
        t0 = datetime.now(timezone.utc)
        for i, img_path in enumerate(images):
            frame = cv2.imread(str(img_path))
            if frame is None:
                continue
            frame = cv2.resize(frame, (width, height))
            ts = (t0.timestamp() + i * interval)
            yield i, frame, datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        return

    cap = cv2.VideoCapture(source)
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video source: {source}")
    interval = 1.0 / max(target_fps, 1e-6)
    last = 0.0
    idx = 0
    try:
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            now = time.monotonic()
            if last and (now - last) < interval:
                continue
            last = now
            if frame.shape[1] != width or frame.shape[0] != height:
                frame = cv2.resize(frame, (width, height))
            yield idx, frame, datetime.now(timezone.utc).isoformat()
            idx += 1
    finally:
        cap.release()


def run_session(
    cfg: dict[str, Any],
    participant_id: str,
    cohort: str,
    *,
    session_id: str | None = None,
    duration_seconds: float | None = None,
    source: int | str | None = None,
    retain_frames: bool | None = None,
    stub_phone: bool = False,
    stop_event: Any | None = None,
    frame_callback: Any | None = None,
) -> dict[str, Any]:
    if cohort not in COHORTS:
        raise ValueError(f"cohort must be one of {COHORTS}")
    assert_consented(cfg, participant_id)
    session_id = session_id or make_session_id(participant_id)
    retain = cfg["capture"]["retain_frames"] if retain_frames is None else retain_frames
    source = cfg["capture"]["device_index"] if source is None else source

    raw_dir = resolve_path(cfg, "raw_dir") / session_id
    if retain:
        raw_dir.mkdir(parents=True, exist_ok=True)

    pipeline = VisualPipeline(cfg, participant_id=participant_id, stub_phone=stub_phone)
    records: list[FrameRecord] = []
    t0 = time.monotonic()
    try:
        for idx, frame, ts in iter_frames(
            source,
            cfg["capture"]["width"],
            cfg["capture"]["height"],
            cfg["capture"]["target_fps"],
        ):
            if stop_event is not None and stop_event.is_set():
                break
            if duration_seconds is not None and (time.monotonic() - t0) >= duration_seconds:
                break
            rec = pipeline.process_frame(
                frame,
                session_id=session_id,
                participant_id=participant_id,
                cohort=cohort,
                frame_index=idx,
                timestamp=ts,
            )
            records.append(rec)
            if frame_callback is not None:
                frame_callback(rec, frame)
            if retain:
                cv2.imwrite(str(raw_dir / f"frame_{idx:06d}.jpg"), frame)
            # Privacy default: `frame` goes out of scope and is not written.
    finally:
        pipeline.close()

    windows = window_frames(records, float(cfg["windowing"]["window_seconds"]))
    windows = [score_window(w, cfg) for w in windows]

    features_dir = resolve_path(cfg, "features_dir")
    features_dir.mkdir(parents=True, exist_ok=True)
    frames_path = features_dir / f"{session_id}_frames.csv"
    windows_path = features_dir / f"{session_id}_windows.parquet"
    pd.DataFrame([r.to_dict() for r in records]).to_csv(frames_path, index=False)
    pd.DataFrame([w.to_dict() for w in windows]).to_parquet(windows_path, index=False)

    export_path = features_dir / f"{session_id}_contract.jsonl"
    write_session_export(windows, export_path)

    meta = {
        "session_id": session_id,
        "participant_id": participant_id,
        "cohort": cohort,
        "n_frames": len(records),
        "n_windows": len(windows),
        "retain_frames": retain,
        "frames_csv": str(frames_path),
        "windows_parquet": str(windows_path),
        "contract_jsonl": str(export_path),
    }
    meta_path = features_dir / f"{session_id}_meta.json"
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return meta


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Component 3 session capture")
    parser.add_argument("--participant-id", required=True)
    parser.add_argument("--cohort", required=True, choices=COHORTS)
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--duration-seconds", type=float, default=None)
    parser.add_argument("--source", default=None, help="Camera index, video file, or image directory")
    parser.add_argument("--retain-frames", action="store_true", help="DEBUG only: write JPEGs under data/raw/")
    parser.add_argument("--config", default=None)
    parser.add_argument("--stub-phone", action="store_true", help="Skip YOLO load (tests / no-weights machines)")
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    source: int | str | None
    if args.source is None:
        source = None
    else:
        source = int(args.source) if args.source.isdigit() else args.source
    meta = run_session(
        cfg,
        args.participant_id,
        args.cohort,
        session_id=args.session_id,
        duration_seconds=args.duration_seconds,
        source=source,
        retain_frames=True if args.retain_frames else None,
        stub_phone=args.stub_phone,
    )
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
