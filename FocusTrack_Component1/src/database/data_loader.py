from pathlib import Path

import pandas as pd

from src.config import RAW_DIR, STUDENT_EXPORT_COLUMNS, TABLES, ensure_data_dirs
from src.database.supabase_client import fetch_all_rows

TABLE_FILES = {
    "students": "students.csv",
    "study_sessions": "study_sessions.csv",
    "behavior_logs": "behavior_logs.csv",
    "concentration_logs": "concentration_logs.csv",
}


def load_table(name: str) -> pd.DataFrame:
    if name not in TABLES:
        raise ValueError(f"Unknown table: {name}")
    return pd.DataFrame(fetch_all_rows(name))


def _prepare_students(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["participant_id", *STUDENT_EXPORT_COLUMNS[1:]])
    keep = [c for c in STUDENT_EXPORT_COLUMNS if c in df.columns]
    out = df.loc[:, keep].copy()
    out = out.rename(columns={"id": "participant_id"})
    return out


def export_raw(raw_dir: Path | None = None) -> dict[str, Path]:
    ensure_data_dirs()
    target = Path(raw_dir or RAW_DIR)
    target.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}
    for table, filename in TABLE_FILES.items():
        df = load_table(table)
        if table == "students":
            df = _prepare_students(df)
        path = target / filename
        df.to_csv(path, index=False)
        written[table] = path
    return written


def load_raw(raw_dir: Path | None = None) -> dict[str, pd.DataFrame]:
    target = Path(raw_dir or RAW_DIR)
    frames: dict[str, pd.DataFrame] = {}
    for table, filename in TABLE_FILES.items():
        path = target / filename
        if not path.exists():
            frames[table] = pd.DataFrame()
            continue
        frames[table] = pd.read_csv(path)
    return frames
