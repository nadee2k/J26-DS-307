"""Probe labels (proposal 3.2 and 3.3).

A focus probe at epoch ``t`` labels the ``probe_window_epochs`` epochs before
it (weak supervision). Ratings are z-scored within each learner; statistics are
fitted on training participants only. A held-out participant is transformed
with the training population fallback, never with their own test ratings.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from focustrack.config import Config

PROBE_COLUMNS = ("session_id", "participant_id", "epoch_index", "rating")


@dataclass
class RatingNormaliser:
    """Learner-normalised ratings, fitted on training probes only."""

    scheme: str = "train_population"
    stats: dict[str, tuple[float, float]] = field(default_factory=dict)
    fallback: tuple[float, float] = (3.0, 1.0)

    def fit(self, probes: pd.DataFrame) -> "RatingNormaliser":
        missing = [c for c in ("participant_id", "rating") if c not in probes.columns]
        if missing:
            raise ValueError(f"probe table is missing columns: {', '.join(missing)}")

        stats: dict[str, tuple[float, float]] = {}
        for pid, group in probes.groupby("participant_id"):
            ratings = group["rating"].astype(float)
            stats[str(pid)] = (float(ratings.mean()), max(float(ratings.std(ddof=0)), 0.5))

        all_ratings = probes["rating"].astype(float)
        self.stats = stats
        self.fallback = (
            float(all_ratings.mean()) if len(all_ratings) else 3.0,
            max(float(all_ratings.std(ddof=0)) if len(all_ratings) else 1.0, 0.5),
        )
        return self

    def transform(self, probes: pd.DataFrame) -> pd.DataFrame:
        """Return ``probes`` with a ``rating_z`` column."""
        out = probes.copy()
        if len(out) == 0:
            out["rating_z"] = pd.Series(dtype=float)
            return out

        pairs = [self.stats.get(str(pid), self.fallback) for pid in out["participant_id"]]
        mean = np.asarray([pair[0] for pair in pairs], dtype=float)
        sd = np.asarray([pair[1] for pair in pairs], dtype=float)
        out["rating_z"] = (out["rating"].astype(float).to_numpy() - mean) / sd
        return out


def label_epochs(
    epochs: pd.DataFrame,
    probes: pd.DataFrame,
    cfg: Config,
    normaliser: RatingNormaliser | None = None,
) -> pd.DataFrame:
    """Attach probe labels to the epochs in the window before each probe.

    If ``normaliser`` is omitted, it is fitted on ``probes`` (fine for EDA).
    For evaluation, fit it on the training probes and pass it in so the test
    participants are transformed with the training fallback.
    """
    missing = [c for c in PROBE_COLUMNS if c not in probes.columns]
    if missing:
        raise ValueError(f"probe table is missing columns: {', '.join(missing)}")

    norm = normaliser or RatingNormaliser(cfg.label_normalisation).fit(probes)
    probe_table = norm.transform(probes)
    probe_table["epoch_index"] = probe_table["epoch_index"].astype(int)

    frames: list[pd.DataFrame] = []
    for probe in probe_table.itertuples(index=False):
        start = max(0, probe.epoch_index - cfg.probe_window_epochs)
        window = epochs[
            (epochs["session_id"] == probe.session_id)
            & (epochs["epoch_index"] >= start)
            & (epochs["epoch_index"] < probe.epoch_index)
        ].copy()
        if window.empty:
            continue
        window["probe_epoch"] = probe.epoch_index
        window["probe_rating"] = float(probe.rating)
        window["rating_z"] = float(probe.rating_z)
        window["observer_rating"] = getattr(probe, "observer", np.nan)
        window["probe_distance"] = probe.epoch_index - window["epoch_index"]
        frames.append(window)

    if not frames:
        raise ValueError("no epochs matched any probe window; check epoch_index units")

    labelled = pd.concat(frames, ignore_index=True)
    # probes are 8–12 minutes apart, so overlap is rare; keep the nearest probe
    labelled = (
        labelled.sort_values(
            ["session_id", "epoch_index", "probe_distance"], kind="mergesort"
        )
        .drop_duplicates(subset=["session_id", "epoch_index"], keep="first")
        .sort_values(["session_id", "epoch_index"], kind="mergesort")
        .drop(columns="probe_distance")
        .reset_index(drop=True)
    )
    labelled["focus_label"] = (labelled["rating_z"] > cfg.focus_z_threshold).astype(int)
    labelled["drop_label"] = (
        labelled["rating_z"] <= cfg.drop_z_threshold
    ).astype(int)
    return labelled
