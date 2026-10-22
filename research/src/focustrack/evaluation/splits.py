"""Validation splits (proposal 3.8).

* leave-one-participant-out (LOPO) – no learner in both train and test;
* leave-one-task-out (LOTO) – among computer-based tasks only, because reading
  sessions have near-zero typing by design.
"""

from __future__ import annotations

import pandas as pd

from focustrack.config import SCREEN_TASKS


def lopo(participants: list[str] | pd.Series) -> list[tuple[list[str], list[str]]]:
    """Return ``(train_pids, test_pids)`` for every participant."""
    pids = sorted({str(p) for p in participants})
    return [([p for p in pids if p != test], [test]) for test in pids]


def leave_one_task_out(
    sessions: pd.DataFrame,
    tasks: tuple[str, ...] = SCREEN_TASKS,
) -> list[tuple[list[str], list[str], str]]:
    """Return ``(train_session_ids, test_session_ids, held_out_task)``."""
    screen = sessions[sessions["study_mode"] == "screen"]
    folds: list[tuple[list[str], list[str], str]] = []
    for task in tasks:
        test = screen[screen["task"] == task]
        train = screen[screen["task"] != task]
        if test.empty or train.empty:
            continue
        folds.append(
            (
                train["session_id"].astype(str).tolist(),
                test["session_id"].astype(str).tolist(),
                task,
            )
        )
    return folds


def assert_disjoint(train_ids: list[str], test_ids: list[str], label: str = "split") -> None:
    overlap = set(train_ids) & set(test_ids)
    if overlap:
        raise AssertionError(f"{label} leaks {len(overlap)} ids: {sorted(overlap)[:5]}")
