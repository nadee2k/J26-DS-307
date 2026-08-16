"""Join window features with self-report labels; participant-level LNPO folds.

Split logic lives here so no training script can accidentally leak frames
across participants (v2 §3).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterator

import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

from component3.config import load_config, resolve_path
from component3.types import FEATURE_COLUMNS, WindowRecord


def map_focus_label(rating: float, threshold: float) -> int:
    """Self-report rating (typically 1–5) → binary focused=1 / distracted=0."""
    return int(float(rating) >= float(threshold))


def load_labels(path: Path, threshold: float) -> pd.DataFrame:
    df = pd.read_csv(path)
    required = {"session_id", "focus_rating"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"Labels file {path} missing columns: {missing}")
    df = df.copy()
    df["y"] = df["focus_rating"].map(lambda r: map_focus_label(r, threshold))
    return df


def windows_to_frame(windows: list[WindowRecord]) -> pd.DataFrame:
    rows = []
    for w in windows:
        row = w.to_dict()
        row.update(w.feature_vector())
        rows.append(row)
    return pd.DataFrame(rows)


def join_labels(features: pd.DataFrame, labels: pd.DataFrame) -> pd.DataFrame:
    keep = ["session_id", "y", "focus_rating"]
    extra = [c for c in ("participant_id", "cohort") if c in labels.columns]
    lab = labels[keep + extra].drop_duplicates("session_id")
    merged = features.merge(lab, on="session_id", how="inner", suffixes=("", "_label"))
    if "participant_id_label" in merged.columns:
        merged["participant_id"] = merged["participant_id"].fillna(merged["participant_id_label"])
        merged = merged.drop(columns=["participant_id_label"])
    if merged.empty:
        raise ValueError("Join produced zero rows — session_id values do not overlap.")
    return merged


def load_feature_table(path: Path) -> pd.DataFrame:
    path = Path(path)
    if path.suffix == ".csv":
        return pd.read_csv(path)
    return pd.read_parquet(path)


def build_training_table(
    cfg: dict[str, Any] | None = None,
    features_path: Path | None = None,
    labels_path: Path | None = None,
) -> pd.DataFrame:
    cfg = cfg or load_config()
    if features_path is None:
        features_dir = resolve_path(cfg, "features_dir")
        parquets = sorted(features_dir.glob("*_windows.parquet"))
        if not parquets:
            raise FileNotFoundError(f"No *_windows.parquet files in {features_dir}")
        frames = [load_feature_table(p) for p in parquets]
        features = pd.concat(frames, ignore_index=True)
    else:
        features = load_feature_table(Path(features_path))
    labels_path = Path(labels_path) if labels_path else resolve_path(cfg, "labels_file")
    labels = load_labels(labels_path, float(cfg["model"]["focus_label_threshold"]))
    return join_labels(features, labels)


def matrix_xy(df: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    missing = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing:
        raise KeyError(f"Feature table missing columns: {missing}")
    X = df[FEATURE_COLUMNS].copy()
    y = df["y"].to_numpy(dtype=int)
    groups = df["participant_id"].astype(str).to_numpy()
    return X, y, groups


def lnpo_folds(
    groups: np.ndarray,
    n_folds: int,
    random_state: int = 42,
) -> Iterator[tuple[int, np.ndarray, np.ndarray]]:
    """Leave-N-Participants-Out via GroupKFold. Yields (fold_idx, train_idx, test_idx)."""
    unique = np.unique(groups)
    n_splits = min(int(n_folds), len(unique))
    if n_splits < 2:
        raise ValueError(
            f"Need at least 2 participants for LNPO CV, found {len(unique)}."
        )
    # GroupKFold does not shuffle; permute group labels via a stable mapping so
    # fold assignment is reproducible from random_state without mixing people.
    rng = np.random.RandomState(random_state)
    order = rng.permutation(unique)
    remap = {g: i for i, g in enumerate(order)}
    encoded = np.array([remap[g] for g in groups])
    gkf = GroupKFold(n_splits=n_splits)
    for i, (train_idx, test_idx) in enumerate(gkf.split(np.zeros(len(groups)), groups=encoded)):
        _assert_no_leakage(groups[train_idx], groups[test_idx])
        yield i, train_idx, test_idx


def _assert_no_leakage(train_groups: np.ndarray, test_groups: np.ndarray) -> None:
    overlap = set(train_groups) & set(test_groups)
    if overlap:
        raise RuntimeError(f"Participant leakage in split: {overlap}")
