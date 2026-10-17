import pandas as pd


def extract_temporal_features(window: pd.DataFrame, session_start, session_end) -> dict:
    start = window["timestamp"].min()
    end = window["timestamp"].max()
    session_duration = max((session_end - session_start).total_seconds(), 1.0)
    progress = (start - session_start).total_seconds() / session_duration
    idle_ratio = 0.0
    if {"keyboard_count", "mouse_distance", "mouse_clicks"}.issubset(window.columns):
        inactive = (
            (window["keyboard_count"].fillna(0) == 0)
            & (window["mouse_distance"].fillna(0) == 0)
            & (window["mouse_clicks"].fillna(0) == 0)
        )
        idle_ratio = float(inactive.mean()) if len(window) else 0.0
    mean_idle = float(window["idle_time"].fillna(0).mean()) if "idle_time" in window else 0.0
    return {
        "window_index": int(window["window_index"].iloc[0]) if "window_index" in window else 0,
        "window_start": start,
        "window_end": end,
        "session_progress": float(max(0.0, min(progress, 1.0))),
        "idle_ratio": idle_ratio,
        "mean_idle_time": mean_idle,
        "n_snapshots": int(len(window)),
    }
