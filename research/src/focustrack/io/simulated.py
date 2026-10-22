"""Data sources: simulated snapshot, CSV exports, and Supabase.

The research pipeline never reads the demo app's in-browser state. It reads
either the frozen simulated snapshot in ``data/raw/`` or an exported table set.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from focustrack.config import Config


def load_simulated(cfg: Config) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load the frozen simulated study (sessions, epochs, probes).

    The snapshot is produced from the PP1 simulator and contains observable
    fields only: the hidden focus process is deliberately not exported.
    """
    raw = cfg.raw_dir
    sessions = pd.read_csv(raw / "sessions.csv")
    epochs = pd.read_csv(raw / "epochs.csv")
    probes = pd.read_csv(raw / "probes.csv")
    return sessions, epochs, probes


def load_csv_tables(raw_dir: str | Path) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load a CSV export with the same three tables as the simulated snapshot."""
    raw = Path(raw_dir)
    return (
        pd.read_csv(raw / "sessions.csv"),
        pd.read_csv(raw / "epochs.csv"),
        pd.read_csv(raw / "probes.csv"),
    )


def load_from_supabase(cfg: Config) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load ``study_sessions``, ``c1_epochs`` and probe rows from Supabase.

    Requires ``SUPABASE_URL`` and a key in the environment (or a ``.env`` file
    in ``research/``). Kept behind an explicit call so tests and notebooks never
    need network access.
    """
    import os

    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv()
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = (
        os.getenv("SUPABASE_ANON_KEY")
        or os.getenv("SUPABASE_PUBLISHABLE_KEY")
        or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    )
    if not url or not key:
        raise RuntimeError(
            "Supabase credentials are not configured. Set SUPABASE_URL and "
            "SUPABASE_ANON_KEY, or use --source simulated/csv."
        )

    client = create_client(url, key)

    def table(name: str, page_size: int = 1000) -> pd.DataFrame:
        rows: list[dict] = []
        start = 0
        while True:
            batch = (
                client.table(name)
                .select("*")
                .range(start, start + page_size - 1)
                .execute()
                .data
            )
            rows.extend(batch)
            if len(batch) < page_size:
                return pd.DataFrame(rows)
            start += page_size

    sessions = table("study_sessions")
    epochs = table("c1_epochs")
    probes = table("concentration_logs")
    return sessions, epochs, probes
