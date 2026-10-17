import pandas as pd


def segment_sessions(events: pd.DataFrame) -> pd.DataFrame:
    if events.empty:
        return events.copy()
    out = events.copy()
    required = ["participant_id", "session_id", "context"]
    for col in required:
        if col not in out.columns:
            out[col] = pd.NA
    return out.sort_values(["participant_id", "session_id", "timestamp"]).reset_index(drop=True)


def session_summary(events: pd.DataFrame) -> pd.DataFrame:
    if events.empty:
        return pd.DataFrame()
    grouped = events.groupby(["participant_id", "session_id", "context"], dropna=False)
    summary = grouped.agg(
        n_events=("timestamp", "size"),
        started_at=("timestamp", "min"),
        ended_at=("timestamp", "max"),
        key_event_count=("keyboard_count", "sum"),
        mouse_distance=("mouse_distance", "sum"),
        mouse_clicks=("mouse_clicks", "sum"),
        application_switch_count=("application_switched", "sum"),
    ).reset_index()
    summary["duration_seconds"] = (
        summary["ended_at"] - summary["started_at"]
    ).dt.total_seconds()
    return summary
