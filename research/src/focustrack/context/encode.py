"""Context encoding (proposal SO5, 3.4.6).

Task and study mode, plus interactions between state and task (and state and
study mode). The reference task and the first state are dropped for linear
models, which avoids exact collinearity with the intercept.
"""

from __future__ import annotations

import pandas as pd

from focustrack.config import Config


def _slug(value: str) -> str:
    return str(value).strip().lower().replace(" ", "_").replace("-", "_")


def encode_context(
    epochs: pd.DataFrame,
    cfg: Config,
    n_states: int | None = None,
    state_column: str = "state",
    state_ids: list[int] | None = None,
    tasks: list[str] | None = None,
) -> pd.DataFrame:
    """Return a copy of ``epochs`` with context and interaction columns.

    ``state_ids`` and ``tasks`` fix the column set across folds, so a held-out
    task or an unused state still has a column (all zeros in training) instead
    of silently changing the feature space.
    """
    required = {"task", "study_mode"}
    missing = required - set(epochs.columns)
    if missing:
        raise ValueError(f"epochs are missing columns: {', '.join(sorted(missing))}")

    out = epochs.copy()
    out["is_screen"] = (out["study_mode"] == "screen").astype(int)

    observed_tasks = sorted(str(t) for t in out["task"].dropna().unique())
    all_tasks = list(tasks) if tasks is not None else observed_tasks
    reference_task = str(cfg.context.get("reference_task", all_tasks[0] if all_tasks else "reading"))
    if reference_task not in all_tasks and all_tasks:
        reference_task = all_tasks[0]
    for task in all_tasks:
        if task == reference_task:
            continue
        out[f"task_{_slug(task)}"] = (out["task"] == task).astype(int)

    if not cfg.context.get("interactions", True):
        return out

    for source, name in (
        ("typing_rate", "screen_x_typing"),
        ("idle_ratio", "screen_x_idle"),
        ("switch_rate", "screen_x_switch"),
    ):
        if source in out.columns:
            out[name] = out["is_screen"] * out[source]

    if state_column not in out.columns:
        return out

    if state_ids is None:
        state_ids = sorted(int(s) for s in out[state_column].dropna().unique())
        if n_states is not None and len(state_ids) < n_states:
            state_ids = list(range(n_states))
    states = sorted(int(s) for s in state_ids)
    if not states:
        return out
    reference_state = states[0]

    for state in states:
        if state == reference_state:
            continue
        in_state = out[state_column] == state
        out[f"state_{state}"] = in_state.astype(int)
        out[f"state_{state}_x_screen"] = (in_state & (out["study_mode"] == "screen")).astype(int)
        for task in all_tasks:
            if task == reference_task:
                continue
            out[f"state_{state}_x_task_{_slug(task)}"] = (
                in_state & (out["task"] == task)
            ).astype(int)

    return out
