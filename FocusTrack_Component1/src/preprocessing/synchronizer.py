import pandas as pd


def synchronize_events(
    behavior: pd.DataFrame,
    sessions: pd.DataFrame,
    students: pd.DataFrame,
) -> pd.DataFrame:
    """Order 1s snapshots into a chronological session stream with context."""
    if behavior.empty:
        return pd.DataFrame(
            columns=[
                "participant_id",
                "session_id",
                "timestamp",
                "event_type",
                "event_information",
                "context",
                "keyboard_count",
                "mouse_distance",
                "mouse_clicks",
                "idle_time",
                "active_application",
                "application_switched",
            ]
        )

    sessions_small = sessions.rename(columns={"id": "session_id"}).copy()
    keep_session = [
        c
        for c in ("session_id", "student_id", "task_type", "started_at", "ended_at", "status")
        if c in sessions_small.columns
    ]
    sessions_small = sessions_small.loc[:, keep_session]

    students_small = students.rename(columns={"id": "participant_id"}).copy()
    if "participant_id" not in students_small.columns and "student_id" in students_small.columns:
        students_small = students_small.rename(columns={"student_id": "participant_id"})
    student_keep = [c for c in ("participant_id", "learning_type") if c in students_small.columns]
    students_small = students_small.loc[:, student_keep] if student_keep else students_small

    events = behavior.copy()
    events["timestamp"] = pd.to_datetime(events["created_at"], utc=True, errors="coerce")
    merged = events.merge(sessions_small, on="session_id", how="left")
    if "student_id" in merged.columns:
        merged = merged.merge(
            students_small,
            left_on="student_id",
            right_on="participant_id",
            how="left",
            suffixes=("", "_student"),
        )
        if "participant_id" not in merged.columns:
            merged["participant_id"] = merged["student_id"]
    else:
        merged["participant_id"] = pd.NA

    merged = merged.sort_values(["session_id", "timestamp"]).reset_index(drop=True)
    prev_app = merged.groupby("session_id")["active_application"].shift(1)
    merged["application_switched"] = (
        prev_app.notna() & (merged["active_application"] != prev_app)
    ).astype(int)

    merged["event_type"] = "behavior_snapshot"
    switched = merged["application_switched"] == 1
    merged.loc[switched, "event_type"] = "application_change"
    merged["event_information"] = merged.apply(
        lambda row: {
            "keyboard_count": row.get("keyboard_count"),
            "mouse_distance": row.get("mouse_distance"),
            "mouse_clicks": row.get("mouse_clicks"),
            "idle_time": row.get("idle_time"),
            "active_application": row.get("active_application"),
        },
        axis=1,
    )
    merged["context"] = merged["task_type"] if "task_type" in merged.columns else pd.NA
    return merged
