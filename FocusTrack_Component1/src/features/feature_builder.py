import pandas as pd

from src.features.application_features import extract_application_features
from src.features.keyboard_features import extract_keyboard_features
from src.features.mouse_features import extract_mouse_features
from src.features.temporal_features import extract_temporal_features


def _session_bounds(events: pd.DataFrame) -> dict:
    bounds = {}
    for session_id, group in events.groupby("session_id"):
        bounds[session_id] = (group["timestamp"].min(), group["timestamp"].max())
    return bounds


def attach_focus_reference(
    windows: pd.DataFrame,
    concentration: pd.DataFrame,
    method: str = "locf",
) -> pd.DataFrame:
    """Attach the self-reported concentration reference to each window.

    ``method`` controls how a session's concentration logs are mapped onto its
    windows: ``locf`` carries the last reported value forward, ``nearest`` uses
    the temporally closest report and ``session`` uses the final report for
    every window. Windows that precede the first report receive ``pd.NA``.
    """
    if windows.empty:
        return windows.copy()
    out = windows.copy()
    if concentration.empty:
        out["focus_reference"] = pd.NA
        return out

    labels = concentration.copy()
    labels["recorded_at"] = pd.to_datetime(labels["recorded_at"], utc=True, errors="coerce")
    labels["level"] = pd.to_numeric(labels["level"], errors="coerce")
    labels = labels.dropna(subset=["session_id", "recorded_at", "level"])
    labels = labels.sort_values(["session_id", "recorded_at"])

    assigned = []
    for session_id, group in out.groupby("session_id", dropna=False):
        g = group.sort_values("window_start").copy()
        session_labels = labels[labels["session_id"] == session_id]
        if session_labels.empty:
            g["focus_reference"] = pd.NA
            assigned.append(g)
            continue
        if method == "session":
            g["focus_reference"] = session_labels.iloc[-1]["level"]
        elif method == "nearest":
            times = session_labels["recorded_at"].to_numpy()
            levels = session_labels["level"].to_numpy()
            g["focus_reference"] = [
                levels[int((abs(times - start.to_datetime64())).argmin())]
                for start in g["window_start"]
            ]
        else:
            right = (
                session_labels[["recorded_at", "level"]]
                .rename(columns={"recorded_at": "label_time", "level": "focus_reference"})
                .sort_values("label_time")
            )
            merged = pd.merge_asof(
                g.sort_values("window_start"),
                right,
                left_on="window_start",
                right_on="label_time",
                direction="backward",
            )
            g = merged.drop(columns=["label_time"], errors="ignore")
        assigned.append(g)
    return pd.concat(assigned, ignore_index=True).reset_index(drop=True)


def build_window_features(
    windowed_events: pd.DataFrame,
    concentration: pd.DataFrame | None = None,
    label_method: str = "locf",
) -> pd.DataFrame:
    if windowed_events.empty:
        return pd.DataFrame()

    bounds = _session_bounds(windowed_events)
    rows = []
    group_cols = ["participant_id", "session_id", "context", "window_index", "window_size_seconds"]
    present = [c for c in group_cols if c in windowed_events.columns]
    for keys, window in windowed_events.groupby(present, dropna=False):
        key_map = dict(zip(present, keys if isinstance(keys, tuple) else (keys,)))
        session_id = key_map.get("session_id")
        start, end = bounds.get(session_id, (window["timestamp"].min(), window["timestamp"].max()))
        duration = float(window["window_size_seconds"].iloc[0]) if "window_size_seconds" in window else 60.0
        row = {
            "participant_id": key_map.get("participant_id"),
            "session_id": session_id,
            "context": key_map.get("context"),
            "window_size_seconds": duration,
        }
        row.update(extract_temporal_features(window, start, end))
        row.update(extract_keyboard_features(window, duration))
        row.update(extract_mouse_features(window, duration))
        app = extract_application_features(window, duration)
        sequence = app.pop("application_sequence")
        row.update(app)
        row["application_sequence"] = "|".join(sequence)
        rows.append(row)

    features = pd.DataFrame(rows)
    if concentration is not None:
        features = attach_focus_reference(features, concentration, method=label_method)
    return features.sort_values(["participant_id", "session_id", "window_start"]).reset_index(drop=True)
