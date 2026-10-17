import numpy as np
import pandas as pd


def extract_mouse_features(window: pd.DataFrame, duration_seconds: float) -> dict:
    duration = max(duration_seconds, 1.0)
    distance = (
        window["mouse_distance"].fillna(0).to_numpy(dtype=float)
        if "mouse_distance" in window
        else np.array([])
    )
    clicks = (
        window["mouse_clicks"].fillna(0).to_numpy(dtype=float)
        if "mouse_clicks" in window
        else np.array([])
    )
    if distance.size == 0:
        return {
            "mouse_event_count": 0,
            "mouse_distance": 0.0,
            "mouse_clicks": 0.0,
            "click_count": 0.0,
            "mean_mouse_velocity": 0.0,
            "std_mouse_velocity": 0.0,
            "mean_mouse_acceleration": 0.0,
        }

    velocity = distance
    accel = np.diff(velocity, prepend=velocity[0])
    activity = ((distance > 0) | (clicks > 0)).astype(int)
    return {
        "mouse_event_count": int(activity.sum()),
        "mouse_distance": float(distance.sum()),
        "mouse_clicks": float(clicks.sum()),
        "click_count": float(clicks.sum()),
        "mean_mouse_velocity": float(velocity.mean()),
        "std_mouse_velocity": float(velocity.std(ddof=0)),
        "mean_mouse_acceleration": float(np.abs(accel).mean()),
        "mouse_click_rate": float(clicks.sum() / duration),
    }
