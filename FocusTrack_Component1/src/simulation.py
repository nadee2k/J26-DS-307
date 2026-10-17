"""Synthetic behavioural data generator.

This module exists so the full pipeline and its tests can be exercised before
real pilot/main data is collected. It produces tables with exactly the same
schema as ``src.database.data_loader.export_raw``.

The generated behaviour contains a *learnable but context-dependent* signal:
the same typing rate means different things in ``coding`` and ``reading``
sessions. This makes it suitable for checking that the baseline / proposed /
ablation comparison runs and that the metrics behave sensibly. It is not a
substitute for real participant data.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

from src.config import RAW_DIR, TASK_TYPES

APPLICATIONS = [
    "main.py - Visual Studio Code",
    "Chrome - Google Docs",
    "Okular - lecture_notes.pdf",
    "Zoom Meeting",
    "Terminal",
    "LibreOffice Writer",
]


def generate_synthetic_tables(
    n_participants: int = 25,
    sessions_per_participant: int = 4,
    duration_seconds: int = 900,
    seed: int = 42,
) -> dict[str, pd.DataFrame]:
    rng = np.random.default_rng(seed)
    base_time = pd.Timestamp("2026-09-01T08:00:00Z")

    students = []
    sessions = []
    behavior = []
    concentration = []

    for p in range(n_participants):
        participant_id = f"{p + 1:08d}-0000-0000-0000-000000000000"
        students.append(
            {
                "participant_id": participant_id,
                "age": int(rng.integers(19, 27)),
                "gender": rng.choice(["male", "female"]),
                "learning_type": rng.choice(["screen", "non-screen"]),
                "created_at": base_time.isoformat(),
            }
        )
        for s in range(sessions_per_participant):
            session_index = p * sessions_per_participant + s
            session_id = f"{session_index + 1:08d}-0000-0000-0000-000000000000"
            context = TASK_TYPES[int(rng.integers(0, len(TASK_TYPES)))]
            high_focus = rng.random() < 0.5
            started_at = base_time + pd.Timedelta(days=p, hours=s * 3)
            ended_at = started_at + pd.Timedelta(seconds=duration_seconds)

            sessions.append(
                {
                    "id": session_id,
                    "student_id": participant_id,
                    "task_type": context,
                    "location": rng.choice(["home", "library", "campus"]),
                    "expected_duration": duration_seconds,
                    "status": "completed",
                    "started_at": started_at.isoformat(),
                    "paused_at": "",
                    "ended_at": ended_at.isoformat(),
                    "created_at": started_at.isoformat(),
                    "updated_at": ended_at.isoformat(),
                }
            )

            behavior.extend(
                _synthetic_session_behavior(
                    rng, session_id, context, high_focus, started_at, duration_seconds
                )
            )

            # Self-reported ratings recorded during/after the session.
            base_level = 4.4 if high_focus else 2.2
            context_bias = {"coding": 0.2, "reading": 0.0, "zoom": -0.3}.get(context, 0.0)
            n_ratings = int(rng.integers(1, 3))
            for r in range(n_ratings):
                recorded_at = started_at + pd.Timedelta(
                    seconds=int(duration_seconds * (r + 1) / (n_ratings + 1))
                )
                level = int(np.clip(round(base_level + context_bias + rng.normal(0, 0.5)), 1, 5))
                concentration.append(
                    {
                        "id": f"{session_index + 1:08d}-{r}",
                        "session_id": session_id,
                        "level": level,
                        "environment": rng.choice(["campus", "house", "study-area", "library", "public"]),
                        "notes": "",
                        "recorded_at": recorded_at.isoformat(),
                    }
                )

    return {
        "students": pd.DataFrame(students),
        "study_sessions": pd.DataFrame(sessions),
        "behavior_logs": pd.DataFrame(behavior),
        "concentration_logs": pd.DataFrame(concentration),
    }


def _synthetic_session_behavior(
    rng: np.random.Generator,
    session_id: str,
    context: str,
    high_focus: bool,
    started_at: pd.Timestamp,
    duration_seconds: int,
) -> list[dict]:
    # Typing intensity depends on BOTH the context and the focus state, so the
    # meaning of a given typing rate genuinely changes with the activity.
    typing_rate = {
        "coding": (4.0, 1.0),
        "writing": (3.0, 0.8),
        "assignment": (2.0, 0.9),
        "reading": (0.3, 0.9),
        "zoom": (0.4, 0.4),
    }.get(context, (1.5, 0.8))
    active_rate, passive_rate = typing_rate
    key_lambda = active_rate if high_focus else passive_rate

    switch_probability = 0.004 if high_focus else 0.03
    rows = []
    current_app = rng.choice(APPLICATIONS)
    for second in range(duration_seconds):
        if rng.random() < switch_probability:
            current_app = rng.choice(APPLICATIONS)
        keyboard_count = int(rng.poisson(key_lambda))
        noise = 1.0 if high_focus else 2.2
        mouse_distance = float(abs(rng.normal(45 * (1 if high_focus else 0.7), 25 * noise)))
        mouse_clicks = int(rng.poisson(0.4 if high_focus else 0.8))
        idle = float(abs(rng.normal(1.0 if high_focus else 3.0, 1.2)))
        rows.append(
            {
                "id": f"{session_id}-{second}",
                "session_id": session_id,
                "keyboard_count": keyboard_count,
                "mouse_distance": mouse_distance,
                "mouse_clicks": mouse_clicks,
                "idle_time": idle,
                "active_application": current_app,
                "created_at": (started_at + pd.Timedelta(seconds=second)).isoformat(),
            }
        )
    return rows


def save_synthetic_raw(
    tables: dict[str, pd.DataFrame] | None = None,
    target_dir: Path | None = None,
) -> dict[str, Path]:
    directory = Path(target_dir or RAW_DIR)
    directory.mkdir(parents=True, exist_ok=True)
    tables = tables or generate_synthetic_tables()
    filenames = {
        "students": "students.csv",
        "study_sessions": "study_sessions.csv",
        "behavior_logs": "behavior_logs.csv",
        "concentration_logs": "concentration_logs.csv",
    }
    written: dict[str, Path] = {}
    for table, filename in filenames.items():
        path = directory / filename
        tables[table].to_csv(path, index=False)
        written[table] = path
    return written
