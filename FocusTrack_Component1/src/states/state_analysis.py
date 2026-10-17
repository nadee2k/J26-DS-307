import pandas as pd

PROFILE_COLS = [
    "typing_rate",
    "mean_mouse_velocity",
    "idle_ratio",
    "application_switch_frequency",
    "mouse_clicks",
]


def _level(series: pd.Series, value: float) -> str:
    if series.empty:
        return "Unknown"
    q1, q2 = series.quantile([0.33, 0.66])
    if value <= q1:
        return "Low"
    if value <= q2:
        return "Medium"
    return "High"


def describe_states(features: pd.DataFrame) -> pd.DataFrame:
    if features.empty or "interaction_state" not in features.columns:
        return pd.DataFrame()
    rows = []
    for state, group in features.groupby("interaction_state"):
        row = {"state": int(state), "n_windows": int(len(group))}
        for col in PROFILE_COLS:
            if col not in group.columns:
                continue
            mean_val = float(group[col].mean())
            row[col] = mean_val
            row[f"{col}_level"] = _level(features[col], mean_val)
        if "context" in group.columns:
            mode = group["context"].mode()
            row["common_context"] = mode.iloc[0] if not mode.empty else None
        if "focus_reference" in group.columns:
            row["mean_focus_reference"] = float(pd.to_numeric(group["focus_reference"], errors="coerce").mean())
        rows.append(row)
    return pd.DataFrame(rows).sort_values("state").reset_index(drop=True)


def behavioural_state_labels(profile: pd.DataFrame) -> dict[int, str]:
    labels = {}
    for _, row in profile.iterrows():
        labels[int(row["state"])] = (
            f"typing={row.get('typing_rate_level', '?')}, "
            f"mouse={row.get('mean_mouse_velocity_level', '?')}, "
            f"idle={row.get('idle_ratio_level', '?')}, "
            f"app_switch={row.get('application_switch_frequency_level', '?')}"
        )
    return labels
