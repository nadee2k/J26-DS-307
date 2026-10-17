"""Validation splits (proposal section 3.11).

Two schemes are provided:

* participant-level splits -- no participant appears in both train and test,
  which prevents participant-specific leakage.
* cross-context splits -- leave-one-learning-activity-out, testing whether the
  representation generalises to an unseen activity.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from src.config import RANDOM_STATE


def participant_folds(
    groups: pd.Series,
    y: pd.Series | None = None,
    n_splits: int = 5,
    seed: int = RANDOM_STATE,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Grouped folds that keep each participant entirely within one fold."""
    from sklearn.model_selection import GroupKFold, StratifiedGroupKFold

    groups = pd.Series(groups).reset_index(drop=True)
    n_groups = groups.nunique()
    if n_groups < 2:
        return []
    n_splits = max(2, min(n_splits, n_groups))
    index = np.arange(len(groups))
    X_placeholder = np.zeros((len(groups), 1))

    if y is not None:
        try:
            splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True, random_state=seed)
            return list(splitter.split(X_placeholder, pd.Series(y).to_numpy(), groups.to_numpy()))
        except Exception:
            pass
    splitter = GroupKFold(n_splits=n_splits)
    return list(splitter.split(X_placeholder, y=None, groups=groups.to_numpy()))


def leave_one_context_out(
    contexts: pd.Series,
) -> list[tuple[str, np.ndarray, np.ndarray]]:
    """Leave-one-context-out splits: ``(held_out_context, train_idx, test_idx)``."""
    contexts = pd.Series(contexts).reset_index(drop=True)
    index = np.arange(len(contexts))
    splits: list[tuple[str, np.ndarray, np.ndarray]] = []
    for context in contexts.dropna().unique():
        test_mask = (contexts == context).to_numpy()
        train_mask = ~test_mask
        if test_mask.sum() == 0 or train_mask.sum() == 0:
            continue
        splits.append((str(context), index[train_mask], index[test_mask]))
    return splits
