"""Classifier interface used by the fold pipeline."""

from __future__ import annotations

from typing import Protocol

import numpy as np


class Classifier(Protocol):
    name: str

    def fit(self, X: np.ndarray, y: np.ndarray) -> "Classifier": ...

    def predict_proba(self, X: np.ndarray) -> np.ndarray: ...
