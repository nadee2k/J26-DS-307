"""Optional facial-expression classifier (lowest-confidence signal).

FER2013-style transfer learning is known to carry cross-dataset and demographic
bias, particularly against non-Western faces. This module is **disabled by
default** (`expression.enabled: false`). When enabled without trained weights
it returns expression_valid=False rather than a guessed label.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np

from component3.types import EXPRESSION_CLASSES


@dataclass
class ExpressionResult:
    label: Optional[str]
    valid: bool
    probabilities: Optional[dict[str, float]] = None
    caveat: str = (
        "Expression is the lowest-confidence optional signal; FER-trained models "
        "may not transfer to Sri Lankan faces. Validate on a labelled pilot subset."
    )


class ExpressionClassifier:
    def __init__(self, cfg: dict[str, Any]) -> None:
        self.cfg = cfg
        self.enabled = bool(cfg.get("expression", {}).get("enabled", False))
        self.classes = list(cfg.get("expression", {}).get("classes", EXPRESSION_CLASSES))
        self._model = None
        self._device = "cpu"
        weights = cfg.get("expression", {}).get("weights")
        if self.enabled and weights:
            self._model = self._load(Path(weights))

    def _load(self, path: Path):
        if not path.exists():
            return None
        try:
            import torch
            from component3.models.arch import MobileNetExpressionNet

            model = MobileNetExpressionNet(n_classes=len(self.classes))
            state = torch.load(path, map_location="cpu")
            model.load_state_dict(state)
            model.eval()
            return model
        except Exception:
            return None

    def predict(self, face_crop: Optional[np.ndarray]) -> ExpressionResult:
        if not self.enabled:
            return ExpressionResult(label=None, valid=False)
        if face_crop is None or self._model is None:
            return ExpressionResult(label=None, valid=False)
        try:
            import torch
            from torchvision.transforms import functional as TF

            rgb = face_crop[:, :, ::-1].copy()
            tensor = TF.to_tensor(rgb).unsqueeze(0)
            tensor = TF.resize(tensor, [224, 224], antialias=True)
            tensor = TF.normalize(tensor, mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])
            with torch.no_grad():
                logits = self._model(tensor)
                probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
            idx = int(np.argmax(probs))
            dist = {c: float(p) for c, p in zip(self.classes, probs)}
            return ExpressionResult(label=self.classes[idx], valid=True, probabilities=dist)
        except Exception:
            return ExpressionResult(label=None, valid=False)
