"""Candidate classifiers (proposal 3.5-3.6)."""

from focustrack.models.majority import MajorityClassifier
from focustrack.models.registry import MODEL_NAMES, build_classifier

__all__ = ["MajorityClassifier", "MODEL_NAMES", "build_classifier"]
