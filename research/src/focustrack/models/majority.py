"""Majority-class baseline (proposal 3.6)."""

from __future__ import annotations

import numpy as np


class MajorityClassifier:
    name = "majority"

    def fit(self, X: np.ndarray, y: np.ndarray) -> "MajorityClassifier":
        self.classes_, counts = np.unique(y, return_counts=True)
        self.prior_ = float(counts.max() / counts.sum()) if len(counts) else 0.5
        self.class_ = int(self.classes_[int(np.argmax(counts))]) if len(counts) else 0
        return self

    def predict_proba(self, X: np.ndarray) -> np.ndarray:
        positive = self.prior_ if self.class_ == 1 else 1.0 - self.prior_
        probability = np.full(len(X), positive, dtype=float)
        return np.column_stack([1.0 - probability, probability])
