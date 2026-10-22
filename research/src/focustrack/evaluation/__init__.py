"""Evaluation: splits, metrics, statistics and the experiment grid."""

from focustrack.evaluation.metrics import classification_metrics
from focustrack.evaluation.splits import assert_disjoint, leave_one_task_out, lopo
from focustrack.evaluation.statistics import (
    bootstrap_ci,
    cohens_dz,
    compare_paired,
    paired_wilcoxon,
)

__all__ = [
    "lopo",
    "leave_one_task_out",
    "assert_disjoint",
    "classification_metrics",
    "paired_wilcoxon",
    "bootstrap_ci",
    "cohens_dz",
    "compare_paired",
]
