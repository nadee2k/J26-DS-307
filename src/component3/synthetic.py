"""Synthetic labelled windows for smoke-testing the ML path without participants."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from component3.config import load_config, resolve_path
from component3.scoring import score_window
from component3.types import WindowRecord


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def generate_windows(
    n_participants: int = 20,
    sessions_per: int = 4,
    windows_per_session: int = 24,
    window_seconds: int = 5,
    random_state: int = 42,
    cfg: dict[str, Any] | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng = np.random.RandomState(random_state)
    windows: list[WindowRecord] = []
    labels = []
    t0 = datetime(2026, 3, 1, tzinfo=timezone.utc)
    for p in range(n_participants):
        pid = f"P{p:03d}"
        cohort = "screen" if p % 2 == 0 else "non_screen"
        for s in range(sessions_per):
            sid = f"c3-{pid}-S{s}"
            # Participant-level base focus propensity so LNPO is meaningful.
            base = rng.uniform(0.25, 0.8)
            rating = 4 if base > 0.5 else 2
            if rng.rand() < 0.15:
                rating = 5 if rating >= 4 else 1
            labels.append(
                {
                    "session_id": sid,
                    "participant_id": pid,
                    "cohort": cohort,
                    "focus_rating": rating,
                }
            )
            focused = rating >= 4
            for w in range(windows_per_session):
                start = t0 + timedelta(days=p, hours=s, seconds=w * window_seconds)
                end = start + timedelta(seconds=window_seconds)
                phone = float(np.clip(rng.beta(2, 8) + (0.25 if not focused else 0.0), 0, 1))
                away = float(np.clip(rng.beta(1.5, 8) + (0.15 if not focused else 0.0), 0, 1))
                gaze_valid = float(np.clip(rng.uniform(0.5, 1.0) - 0.3 * away, 0, 1))
                off = float(np.clip(rng.beta(2, 6) + (0.25 if not focused else 0.0), 0, 1))
                rec = WindowRecord(
                    session_id=sid,
                    participant_id=pid,
                    cohort=cohort,
                    window_start=_iso(start),
                    window_end=_iso(end),
                    n_frames=max(1, int(3 * window_seconds)),
                    face_present_ratio=float(np.clip(1.0 - away, 0, 1)),
                    face_valid_ratio=float(np.clip(0.9 - away, 0, 1)),
                    away_from_desk_ratio=away,
                    blurred_ratio=float(rng.beta(1, 12)),
                    occluded_ratio=float(rng.beta(1, 10)),
                    glare_ratio=float(rng.beta(1, 15)),
                    yaw_mean=float(rng.normal(0, 12 if focused else 22)),
                    yaw_std=float(abs(rng.normal(6, 3))),
                    pitch_mean=float(rng.normal(-5, 8)),
                    pitch_std=float(abs(rng.normal(4, 2))),
                    roll_mean=float(rng.normal(0, 5)),
                    roll_std=float(abs(rng.normal(3, 1))),
                    gaze_valid_ratio=gaze_valid,
                    off_screen_gaze_ratio=off if gaze_valid > 0 else None,
                    phone_present_ratio=phone,
                    phone_confidence_max=float(np.clip(phone + rng.uniform(-0.1, 0.1), 0, 1)),
                    expression_valid_ratio=0.0,
                    dominant_expression="unavailable",
                    phone_detected=phone > 0.05,
                )
                if cfg is not None:
                    rec = score_window(rec, cfg)
                windows.append(rec)
    feat = pd.DataFrame([w.to_dict() | w.feature_vector() for w in windows])
    lab = pd.DataFrame(labels)
    return feat, lab


def write_synthetic(cfg: dict[str, Any], n_participants: int, out: Path | None = None) -> dict[str, str]:
    feat, lab = generate_windows(
        n_participants=n_participants,
        random_state=int(cfg["model"]["random_state"]),
        cfg=cfg,
        window_seconds=int(cfg["windowing"]["window_seconds"]),
    )
    features_dir = resolve_path(cfg, "features_dir")
    features_dir.mkdir(parents=True, exist_ok=True)
    labels_path = resolve_path(cfg, "labels_file")
    labels_path.parent.mkdir(parents=True, exist_ok=True)
    out = Path(out) if out else features_dir / "windows.parquet"
    out.parent.mkdir(parents=True, exist_ok=True)
    feat.to_parquet(out, index=False)
    lab.to_csv(labels_path, index=False)
    return {"features": str(out), "labels": str(labels_path), "n_windows": str(len(feat))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate synthetic Component 3 windows + labels")
    parser.add_argument("--config", default=None)
    parser.add_argument("--n-participants", type=int, default=20)
    parser.add_argument("--out", default=None)
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    info = write_synthetic(cfg, args.n_participants, Path(args.out) if args.out else None)
    print(info)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
