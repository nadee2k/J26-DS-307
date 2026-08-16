"""Consent gate and capture helpers."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest

from component3.capture import ConsentError, assert_consented, iter_frames, load_consent_ids
from component3.config import load_config


def test_consent_required(cfg: dict, tmp_path: Path) -> None:
    consent = Path(cfg["paths"]["consent_file"])
    consent.write_text("participant_id,consented\nP001,true\nP002,false\n", encoding="utf-8")
    assert load_consent_ids(consent) == {"P001"}
    assert_consented(cfg, "P001")
    with pytest.raises(ConsentError):
        assert_consented(cfg, "P002")
    with pytest.raises(ConsentError):
        assert_consented(cfg, "UNKNOWN")


def test_retain_frames_default_is_false() -> None:
    cfg = load_config()
    assert cfg["capture"]["retain_frames"] is False


def test_iter_frames_from_image_dir(tmp_path: Path) -> None:
    folder = tmp_path / "imgs"
    folder.mkdir()
    for i in range(3):
        img = np.zeros((80, 100, 3), dtype=np.uint8)
        img[:] = i * 40
        cv2.imwrite(str(folder / f"{i:02d}.png"), img)
    frames = list(iter_frames(str(folder), width=64, height=48, target_fps=2))
    assert len(frames) == 3
    idx, frame, ts = frames[0]
    assert idx == 0
    assert frame.shape == (48, 64, 3)
    assert "T" in ts
