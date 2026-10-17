"""Reusable plotting helpers for exploratory analysis and reporting."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

from src.config import STATE_COL


def _save(fig, target: str | Path) -> Path:
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)
    return path


def plot_feature_distributions(features: pd.DataFrame, columns: list[str], target: str | Path) -> Path:
    columns = [c for c in columns if c in features.columns]
    fig, axes = plt.subplots(len(columns), 1, figsize=(7, 2.2 * max(len(columns), 1)))
    axes = axes if len(columns) > 1 else [axes]
    for axis, column in zip(axes, columns):
        series = pd.to_numeric(features[column], errors="coerce").dropna()
        axis.hist(series, bins=30, color="#4c72b0")
        axis.set_title(column)
        axis.set_ylabel("windows")
    return _save(fig, target)


def plot_state_profiles(profile: pd.DataFrame, target: str | Path) -> Path:
    fig, axis = plt.subplots(figsize=(8, 4))
    value_cols = [c for c in profile.columns if c.endswith("_level") is False and c not in {"state", "n_windows", "common_context", "mean_focus_reference"} and profile[c].dtype.kind in "fi"]
    if "n_windows" in profile.columns:
        axis.bar(profile["state"].astype(str), profile["n_windows"], color="#dd8452")
        axis.set_xlabel("interaction state")
        axis.set_ylabel("windows")
    else:
        axis.axis("off")
    axis.set_title(f"State sizes (profile columns: {', '.join(value_cols) or 'n/a'})")
    return _save(fig, target)


def plot_transition_heatmap(transition_probs: pd.DataFrame, target: str | Path) -> Path:
    fig, axis = plt.subplots(figsize=(5.5, 4.5))
    if transition_probs.empty:
        axis.axis("off")
        return _save(fig, target)
    matrix = transition_probs.pivot_table(
        index="from_state", columns="to_state", values="probability", aggfunc="mean"
    ).fillna(0.0)
    image = axis.imshow(matrix.to_numpy(), cmap="viridis", vmin=0, vmax=1)
    axis.set_xticks(range(matrix.shape[1]), [str(c) for c in matrix.columns])
    axis.set_yticks(range(matrix.shape[0]), [str(c) for c in matrix.index])
    axis.set_xlabel("to state")
    axis.set_ylabel("from state")
    axis.set_title("Transition probabilities")
    fig.colorbar(image, ax=axis, fraction=0.046, pad=0.04)
    return _save(fig, target)


def plot_experiment_summary(summary: pd.DataFrame, target: str | Path) -> Path:
    fig, axis = plt.subplots(figsize=(9, 4.5))
    if summary.empty:
        axis.axis("off")
        return _save(fig, target)
    for split, group in summary.groupby("split"):
        pivot = group.pivot_table(index="representation", columns="model", values="macro_f1_mean")
        pivot.plot(kind="bar", ax=axis, rot=30)
        break
    axis.set_ylabel("mean Macro-F1")
    axis.set_title("Representation comparison")
    axis.legend(title="model", fontsize=8)
    return _save(fig, target)
