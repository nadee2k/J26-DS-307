"""Epoch boundaries (proposal 3.4.3: one-minute windows)."""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class Epoch:
    index: int
    start_s: float
    end_s: float
    partial: bool


def epoch_bounds(duration_seconds: float, epoch_seconds: int) -> list[Epoch]:
    """Split a session into consecutive epochs, marking a short final epoch."""
    if duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive")
    if epoch_seconds <= 0:
        raise ValueError("epoch_seconds must be positive")

    n = math.ceil(duration_seconds / epoch_seconds)
    out: list[Epoch] = []
    for index in range(n):
        start = index * epoch_seconds
        end = min((index + 1) * epoch_seconds, duration_seconds)
        out.append(
            Epoch(
                index=index,
                start_s=float(start),
                end_s=float(end),
                partial=end - start < epoch_seconds,
            )
        )
    return out
