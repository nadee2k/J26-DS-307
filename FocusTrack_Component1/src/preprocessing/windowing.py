import pandas as pd


def create_time_windows(
    events: pd.DataFrame,
    window_size_seconds: int = 60,
) -> pd.DataFrame:
    if events.empty:
        return events.copy()

    frames = []
    for session_id, group in events.groupby("session_id", dropna=False):
        g = group.sort_values("timestamp").copy()
        origin = g["timestamp"].min()
        if pd.isna(origin):
            continue
        elapsed = (g["timestamp"] - origin).dt.total_seconds().fillna(0)
        g["window_index"] = (elapsed // window_size_seconds).astype(int)
        g["window_start"] = origin + pd.to_timedelta(
            g["window_index"] * window_size_seconds, unit="s"
        )
        g["window_end"] = g["window_start"] + pd.to_timedelta(window_size_seconds, unit="s")
        g["window_size_seconds"] = window_size_seconds
        frames.append(g)
    if not frames:
        return events.copy()
    return pd.concat(frames, ignore_index=True)
