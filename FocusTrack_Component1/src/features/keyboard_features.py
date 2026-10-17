import numpy as np
import pandas as pd


def _burst_stats(counts: np.ndarray) -> tuple[int, float, float]:
    bursts = []
    length = 0
    for value in counts:
        if value > 0:
            length += 1
        elif length:
            bursts.append(length)
            length = 0
    if length:
        bursts.append(length)
    if not bursts:
        return 0, 0.0, 0.0
    arr = np.array(bursts, dtype=float)
    return int(len(arr)), float(arr.mean()), float(arr.mean())


def extract_keyboard_features(window: pd.DataFrame, duration_seconds: float) -> dict:
    counts = window["keyboard_count"].fillna(0).to_numpy(dtype=float) if "keyboard_count" in window else np.array([])
    duration = max(duration_seconds, 1.0)
    if counts.size == 0:
        return {
            "key_event_count": 0,
            "typing_duration": 0.0,
            "typing_rate": 0.0,
            "mean_keyboard_count": 0.0,
            "std_keyboard_count": 0.0,
            "max_keyboard_count": 0.0,
            "burst_count": 0,
            "mean_burst_duration": 0.0,
            "mean_burst_length": 0.0,
        }
    active = counts > 0
    burst_count, mean_burst_length, mean_burst_duration = _burst_stats(counts)
    return {
        "key_event_count": float(counts.sum()),
        "typing_duration": float(active.sum()),
        "typing_rate": float(counts.sum() / duration),
        "mean_keyboard_count": float(counts.mean()),
        "std_keyboard_count": float(counts.std(ddof=0)),
        "max_keyboard_count": float(counts.max()),
        "burst_count": burst_count,
        "mean_burst_duration": mean_burst_duration,
        "mean_burst_length": mean_burst_length,
    }
