import pandas as pd

from src.preprocessing.cleaner import clean_behavior_logs, clean_concentration_logs, clean_sessions
from src.preprocessing.synchronizer import synchronize_events
from src.preprocessing.windowing import create_time_windows


def _behavior_rows():
    base = pd.Timestamp("2026-09-01T08:00:00Z")
    rows = []
    for i in range(5):
        rows.append(
            {
                "id": f"b{i}",
                "session_id": "s1",
                "keyboard_count": 3,
                "mouse_distance": 10.0,
                "mouse_clicks": 1,
                "idle_time": 0.5,
                "active_application": "main.py - Visual Studio Code",
                "created_at": (base + pd.Timedelta(seconds=i)).isoformat(),
            }
        )
    # duplicate + invalid timestamp + negative value
    rows.append(dict(rows[0]))
    rows.append({**rows[1], "id": "bad", "created_at": "not-a-date"})
    rows.append({**rows[2], "id": "neg", "keyboard_count": -5})
    return pd.DataFrame(rows)


def test_clean_behavior_logs_drops_bad_rows():
    cleaned = clean_behavior_logs(_behavior_rows())
    assert "bad" not in cleaned["id"].values
    assert "neg" not in cleaned["id"].values
    assert len(cleaned) == len(cleaned.drop_duplicates(subset=["id"]))
    assert cleaned["timestamp_valid"].all()


def test_clean_sessions_parses_timestamps():
    frame = pd.DataFrame(
        [
            {
                "id": "s1",
                "student_id": "p1",
                "task_type": "coding",
                "started_at": "2026-09-01T08:00:00Z",
                "ended_at": "2026-09-01T08:10:00Z",
                "created_at": "2026-09-01T08:00:00Z",
            }
        ]
    )
    cleaned = clean_sessions(frame)
    assert str(cleaned["started_at"].dtype).startswith("datetime64")


def test_clean_concentration_logs_bounds_levels():
    frame = pd.DataFrame(
        [
            {"id": "c1", "session_id": "s1", "level": 4, "recorded_at": "2026-09-01T08:05:00Z"},
            {"id": "c2", "session_id": "s1", "level": 9, "recorded_at": "2026-09-01T08:06:00Z"},
        ]
    )
    cleaned = clean_concentration_logs(frame)
    assert cleaned["level"].between(1, 5).all()
    assert set(cleaned["level"]) == {4}


def test_synchronize_events_adds_context_and_switches():
    behavior = clean_behavior_logs(_behavior_rows())
    sessions = pd.DataFrame(
        [
            {
                "id": "s1",
                "student_id": "p1",
                "task_type": "coding",
                "started_at": pd.Timestamp("2026-09-01T08:00:00Z"),
                "ended_at": pd.Timestamp("2026-09-01T08:10:00Z"),
                "created_at": pd.Timestamp("2026-09-01T08:00:00Z"),
            }
        ]
    )
    students = pd.DataFrame([{"participant_id": "p1", "learning_type": "screen"}])
    events = synchronize_events(behavior, sessions, students)
    assert (events["context"] == "coding").all()
    assert (events["participant_id"] == "p1").all()
    assert events["application_switched"].iloc[0] == 0


def test_create_time_windows_assigns_indices():
    events = pd.DataFrame(
        {
            "session_id": ["s1"] * 130,
            "timestamp": pd.date_range("2026-09-01T08:00:00Z", periods=130, freq="s"),
        }
    )
    windows = create_time_windows(events, window_size_seconds=60)
    assert windows["window_index"].max() == 2
    assert windows["window_size_seconds"].iloc[0] == 60
