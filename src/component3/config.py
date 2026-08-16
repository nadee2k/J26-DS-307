"""Load and resolve the Component 3 YAML config (single source of truth)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CONFIG_PATH = PACKAGE_ROOT / "config" / "default.yaml"


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    cfg_path = Path(path) if path else DEFAULT_CONFIG_PATH
    if not cfg_path.is_absolute():
        candidate = PACKAGE_ROOT / cfg_path
        cfg_path = candidate if candidate.exists() else cfg_path
    with open(cfg_path, encoding="utf-8") as fh:
        cfg = yaml.safe_load(fh) or {}
    cfg["_config_path"] = str(cfg_path)
    cfg["_root"] = str(PACKAGE_ROOT)
    return cfg


def resolve_path(cfg: dict[str, Any], key: str) -> Path:
    """Resolve a paths.* entry relative to the package root."""
    raw = cfg["paths"][key]
    p = Path(raw)
    if p.is_absolute():
        return p
    return Path(cfg["_root"]) / p
