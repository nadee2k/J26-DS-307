"""Turn an epoch table into HMM sequences without leaking across sessions.

Epochs are ordered within a session; a missing epoch starts a new sequence so
that the HMM never sees an artificial transition across a gap.
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def build_sequences(
    epochs: pd.DataFrame,
    feature_columns: list[str],
) -> tuple[np.ndarray, np.ndarray, pd.DataFrame]:
    """Return ``(X, lengths, meta)`` aligned row-by-row."""
    missing = [c for c in feature_columns if c not in epochs.columns]
    if missing:
        raise ValueError(f"epoch table is missing state features: {', '.join(missing)}")

    meta_parts: list[pd.DataFrame] = []
    x_parts: list[np.ndarray] = []
    lengths: list[int] = []

    for _, session in epochs.groupby("session_id", sort=False):
        session = session.sort_values("epoch_index", kind="mergesort")
        gaps = np.where(np.diff(session["epoch_index"].to_numpy()) != 1)[0] + 1
        for positions in np.split(np.arange(len(session)), gaps):
            block = session.iloc[positions]
            if block.empty:
                continue
            values = block[feature_columns].to_numpy(dtype=float)
            if not np.isfinite(values).all():
                raise ValueError(
                    "state features contain NaN; impute or drop those epochs inside "
                    "the training pipeline before fitting the HMM"
                )
            x_parts.append(values)
            lengths.append(len(block))
            meta_parts.append(block[["session_id", "participant_id", "epoch_index"]])

    if not x_parts:
        raise ValueError("no epochs to sequence")
    return np.vstack(x_parts), np.asarray(lengths, dtype=int), pd.concat(
        meta_parts, ignore_index=True
    )
