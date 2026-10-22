"""Configuration and canonical column definitions for Component 1.

Everything that defines the behavioural representation lives here (or in
``configs/*.yaml``) so preprocessing, features, labels, states, models and
evaluation agree on names and constants.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]  # research/

# Study design (proposal 3.2)
SCREEN_TASKS = ("coding", "writing", "assignment", "zoom")
NON_SCREEN_TASKS = ("reading", "handwriting")
ALL_TASKS = SCREEN_TASKS + NON_SCREEN_TASKS

# Canonical epoch feature columns produced by ``features.build``.
# The list is ordered: models and the exported web artifact rely on this order.
FEATURE_COLUMNS: tuple[str, ...] = (
    "typing_rate",          # keys per minute
    "inter_key_mean_ms",    # mean inter-key interval
    "inter_key_cv",         # coefficient of variation of inter-key intervals
    "backspace_ratio",      # Backspace/Delete share of key events
    "burst_count",          # typing bursts per minute
    "mean_burst_duration_s",
    "mean_burst_length",    # keys per burst
    "mouse_path_px",
    "mouse_speed_px_s",
    "click_rate",           # clicks per minute
    "idle_ratio",
    "switch_rate",          # application switches per minute
    "unique_apps",
    "app_category_entropy", # Shannon entropy (bits) over application categories
)

# Native columns (already computed by the logger or the simulator).
NATIVE_EPOCH_COLUMNS: tuple[str, ...] = (
    "typing_rate",
    "inter_key_cv",
    "backspace_ratio",
    "idle_ratio",
    "mouse_speed_px_s",
    "switch_rate",
)

# Columns the current PP1 logger/simulator does not expose; they stay NaN until
# event-level key timing is persisted (see docs/DECISIONS.md).
EVENT_ONLY_COLUMNS: tuple[str, ...] = (
    "inter_key_mean_ms",
    "burst_count",
    "mean_burst_duration_s",
    "mean_burst_length",
    "click_rate",
    "unique_apps",
    "app_category_entropy",
)

ID_COLUMNS: tuple[str, ...] = (
    "session_id",
    "participant_id",
    "epoch_index",
    "epoch_start_s",
    "epoch_end_s",
    "study_mode",
    "task",
)

CANONICAL_COLUMNS: tuple[str, ...] = ID_COLUMNS + FEATURE_COLUMNS

# Features that are undefined when too few keys were pressed: rhythm and
# corrections are not measurable in a quiet reading epoch.
CONDITIONAL_COLUMNS: tuple[str, ...] = ("inter_key_cv", "backspace_ratio")

MISSING_FLAG_COLUMNS: tuple[str, ...] = EVENT_ONLY_COLUMNS + CONDITIONAL_COLUMNS


@dataclass(frozen=True)
class Config:
    """Validated, merged experiment configuration."""

    name: str
    seed: int
    epoch_seconds: int
    probe_window_epochs: int
    burst_gap_seconds: float
    min_keys_for_rhythm: int
    focus_z_threshold: float
    drop_z_threshold: float
    label_normalisation: str
    app_categories: dict[str, list[str]]
    paths: dict[str, str]
    state_features: list[str] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)
    recovery_epochs: int = 3
    representation: dict[str, bool] = field(default_factory=dict)
    models: list[str] = field(default_factory=list)
    states: dict[str, Any] = field(default_factory=dict)
    ablations: dict[str, dict[str, bool]] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    # Resolved absolute paths -------------------------------------------------
    def path(self, key: str) -> Path:
        return ROOT / self.paths[key]

    @property
    def raw_dir(self) -> Path:
        return self.path("raw")

    @property
    def processed_dir(self) -> Path:
        return self.path("processed")

    @property
    def artifacts_dir(self) -> Path:
        return self.path("artifacts")


def _read_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a YAML mapping")
    return data


def _load_with_extends(path: Path, seen: set[Path] | None = None) -> dict[str, Any]:
    """Load a config and merge its ``extends`` parent (child keys win)."""
    seen = seen or set()
    path = path.resolve()
    if path in seen:
        raise ValueError(f"circular config extends: {path}")
    seen.add(path)

    data = _read_yaml(path)
    parent_name = data.pop("extends", None)
    if not parent_name:
        return data

    parent_path = (path.parent / parent_name).resolve()
    parent = _load_with_extends(parent_path, seen)
    return _deep_merge(parent, data)


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def load_config(path: str | Path = ROOT / "configs" / "c1_proposed.yaml") -> Config:
    """Load ``path`` (plus any ``extends`` chain) into a :class:`Config`."""
    data = _load_with_extends(Path(path))
    required = (
        "seed",
        "epoch_seconds",
        "probe_window_epochs",
        "burst_gap_seconds",
        "min_keys_for_rhythm",
        "focus_z_threshold",
        "drop_z_threshold",
        "label_normalisation",
        "app_categories",
        "paths",
    )
    missing = [key for key in required if key not in data]
    if missing:
        raise ValueError(f"config {path} is missing: {', '.join(missing)}")
    if data["label_normalisation"] not in {"train_population", "within_learner"}:
        raise ValueError("label_normalisation must be train_population or within_learner")

    return Config(
        name=str(data.get("name", Path(path).stem)),
        seed=int(data["seed"]),
        epoch_seconds=int(data["epoch_seconds"]),
        probe_window_epochs=int(data["probe_window_epochs"]),
        burst_gap_seconds=float(data["burst_gap_seconds"]),
        min_keys_for_rhythm=int(data["min_keys_for_rhythm"]),
        focus_z_threshold=float(data["focus_z_threshold"]),
        drop_z_threshold=float(data["drop_z_threshold"]),
        label_normalisation=str(data["label_normalisation"]),
        app_categories={k: list(v) for k, v in data["app_categories"].items()},
        paths={k: str(v) for k, v in data["paths"].items()},
        state_features=list(data.get("state_features", [])),
        context=dict(data.get("context", {})),
        recovery_epochs=int(data.get("recovery_epochs", 3)),
        representation=dict(data.get("representation", {})),
        models=list(data.get("models", [])),
        states=dict(data.get("states", {})),
        ablations=dict(data.get("ablations", {})),
        raw=data,
    )
