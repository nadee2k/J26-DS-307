import pandas as pd


def remove_duplicates(df: pd.DataFrame, subset: list[str] | None = None) -> pd.DataFrame:
    if df.empty:
        return df.copy()
    cols = subset if subset is not None else (["id"] if "id" in df.columns else None)
    return df.drop_duplicates(subset=cols, keep="first").copy()


def validate_timestamps(df: pd.DataFrame, column: str = "created_at") -> pd.DataFrame:
    if df.empty or column not in df.columns:
        out = df.copy()
        out["timestamp_valid"] = False
        return out
    out = df.copy()
    parsed = pd.to_datetime(out[column], utc=True, errors="coerce")
    out[column] = parsed
    out["timestamp_valid"] = parsed.notna()
    return out


def remove_invalid_values(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df.copy()
    out = df.copy()
    for col in ("keyboard_count", "mouse_clicks"):
        if col in out.columns:
            out = out[out[col].fillna(0) >= 0]
    for col in ("mouse_distance", "idle_time"):
        if col in out.columns:
            out = out[out[col].fillna(0) >= 0]
    return out.reset_index(drop=True)


def handle_missing_values(df: pd.DataFrame) -> pd.DataFrame:
    """Keep zero activity. Drop rows that cannot be used as events."""
    if df.empty:
        return df.copy()
    out = df.copy()
    required = [c for c in ("session_id", "created_at") if c in out.columns]
    out = out.dropna(subset=required)
    for col in ("keyboard_count", "mouse_clicks"):
        if col in out.columns:
            out[col] = out[col].fillna(0).astype(int)
    for col in ("mouse_distance", "idle_time"):
        if col in out.columns:
            out[col] = out[col].fillna(0.0)
    if "active_application" in out.columns:
        out["active_application"] = out["active_application"].fillna("Unknown")
    return out.reset_index(drop=True)


def clean_behavior_logs(df: pd.DataFrame) -> pd.DataFrame:
    out = remove_duplicates(df)
    out = validate_timestamps(out, "created_at")
    out = out[out["timestamp_valid"]].copy()
    out = handle_missing_values(out)
    out = remove_invalid_values(out)
    return out.reset_index(drop=True)


def clean_sessions(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df.copy()
    out = remove_duplicates(df)
    for col in ("started_at", "ended_at", "paused_at", "created_at"):
        if col in out.columns:
            out[col] = pd.to_datetime(out[col], utc=True, errors="coerce")
    return out.reset_index(drop=True)


def clean_concentration_logs(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df.copy()
    out = remove_duplicates(df)
    out = validate_timestamps(out, "recorded_at")
    out = out[out["timestamp_valid"]].copy()
    if "level" in out.columns:
        out = out[out["level"].between(1, 5)]
    return out.dropna(subset=["session_id", "recorded_at"]).reset_index(drop=True)
