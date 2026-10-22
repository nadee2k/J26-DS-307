"""Data source registry."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from focustrack.config import Config
from focustrack.io.simulated import load_csv_tables, load_from_supabase, load_simulated

SOURCES = ("simulated", "csv", "supabase")


def load_source(
    source: str,
    cfg: Config,
    csv_dir: str | Path | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load ``(sessions, epochs, probes)`` from the selected source."""
    if source == "simulated":
        return load_simulated(cfg)
    if source == "csv":
        if csv_dir is None:
            raise ValueError("--csv-dir is required when --source csv")
        return load_csv_tables(csv_dir)
    if source == "supabase":
        return load_from_supabase(cfg)
    raise ValueError(f"unknown source {source!r}; choose from {SOURCES}")
