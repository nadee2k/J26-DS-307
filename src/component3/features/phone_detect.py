"""YOLOv8n phone detection + occlusion-aware fine-tune entrypoint.

Plain COCO-pretrained YOLOv8 is a reasonable start, but classroom literature
shows small, hand-occluded phones are a weak point — the fine-tune path
deliberately enables mosaic, aggressive scale-down, and random erasing.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np

from component3.config import load_config, resolve_path


@dataclass
class PhoneDetection:
    present: bool
    confidence: float
    n_boxes: int = 0


class PhoneDetector:
    """Lazy-loads Ultralytics YOLOv8. Safe to construct when weights are missing (tests)."""

    def __init__(self, cfg: dict[str, Any], stub: bool = False) -> None:
        self.cfg = cfg
        self.stub = stub
        self._model = None
        self._load_failed = False

    def _ensure_model(self):
        if self.stub or self._load_failed:
            return None
        if self._model is not None:
            return self._model
        try:
            from ultralytics import YOLO

            weights = self.cfg["phone"]["weights"]
            self._model = YOLO(weights)
            return self._model
        except Exception:
            self._load_failed = True
            return None

    def detect(self, frame_bgr: np.ndarray) -> PhoneDetection:
        model = self._ensure_model()
        if model is None:
            return PhoneDetection(present=False, confidence=0.0, n_boxes=0)
        conf_th = float(self.cfg["phone"]["confidence_threshold"])
        class_id = int(self.cfg["phone"]["cellphone_class_id"])
        imgsz = int(self.cfg["phone"]["imgsz"])
        results = model.predict(
            frame_bgr,
            conf=conf_th,
            imgsz=imgsz,
            classes=[class_id],
            verbose=False,
        )
        best = 0.0
        n_boxes = 0
        for result in results:
            if result.boxes is None:
                continue
            for box in result.boxes:
                n_boxes += 1
                conf = float(box.conf[0]) if box.conf is not None else 0.0
                if conf > best:
                    best = conf
        return PhoneDetection(present=best >= conf_th and n_boxes > 0, confidence=best, n_boxes=n_boxes)


def finetune_phone(
    cfg: dict[str, Any],
    data_yaml: str | Path | None = None,
    epochs: int | None = None,
    project: str | Path | None = None,
) -> Path:
    """Fine-tune YOLOv8n with hand-occlusion-oriented augmentation."""
    from ultralytics import YOLO

    ft = cfg["phone_finetune"]
    data_yaml = Path(data_yaml) if data_yaml else Path(ft["data_yaml"])
    if not data_yaml.is_absolute():
        data_yaml = Path(cfg["_root"]) / data_yaml
    if not data_yaml.exists():
        raise FileNotFoundError(
            f"Phone dataset yaml not found: {data_yaml}. "
            "Label a pilot set that includes hand-near-face and phone-in-hand examples."
        )
    epochs = int(epochs if epochs is not None else ft["epochs"])
    project = Path(project) if project else resolve_path(cfg, "artifacts_dir") / "phone_finetune"
    project.mkdir(parents=True, exist_ok=True)

    model = YOLO(cfg["phone"]["weights"])
    model.train(
        data=str(data_yaml),
        epochs=epochs,
        imgsz=int(cfg["phone"]["imgsz"]),
        batch=int(ft["batch"]),
        mosaic=float(ft["mosaic"]),
        scale=float(ft["scale"]),
        erasing=float(ft["erasing"]),
        fliplr=float(ft["fliplr"]),
        hsv_h=float(ft["hsv_h"]),
        hsv_s=float(ft["hsv_s"]),
        hsv_v=float(ft["hsv_v"]),
        project=str(project),
        name="yolov8n_phone",
        exist_ok=True,
        verbose=True,
    )
    best = project / "yolov8n_phone" / "weights" / "best.pt"
    return best


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fine-tune YOLOv8n for hand-occluded phone detection")
    parser.add_argument("--config", default=None)
    parser.add_argument("--data", default=None, help="YOLO data.yaml path")
    parser.add_argument("--epochs", type=int, default=None)
    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    out = finetune_phone(cfg, data_yaml=args.data, epochs=args.epochs)
    print(f"Fine-tuned weights: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
