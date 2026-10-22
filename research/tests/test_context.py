import pandas as pd

from focustrack.context.encode import encode_context


def epochs():
    return pd.DataFrame(
        {
            "session_id": ["s1", "s1", "s2", "s2", "s3", "s3"],
            "participant_id": ["p1", "p1", "p2", "p2", "p3", "p3"],
            "epoch_index": [0, 1, 0, 1, 0, 1],
            "study_mode": ["screen", "screen", "non-screen", "non-screen", "screen", "screen"],
            "task": ["coding", "coding", "reading", "reading", "assignment", "assignment"],
            "state": [0, 1, 0, 1, 0, 1],
            "typing_rate": [50.0, 10.0, 0.0, 0.0, 30.0, 5.0],
            "idle_ratio": [0.2, 0.8, 0.95, 0.9, 0.4, 0.9],
            "switch_rate": [1.0, 3.0, 0.1, 0.2, 1.5, 2.5],
        }
    )


def test_context_columns(cfg):
    out = encode_context(epochs(), cfg, n_states=2)

    assert out["is_screen"].tolist() == [1, 1, 0, 0, 1, 1]
    assert "task_coding" in out.columns
    assert "task_assignment" in out.columns
    assert "task_reading" not in out.columns  # reference task
    assert (out.loc[out["task"] == "reading", "task_coding"] == 0).all()


def test_interactions(cfg):
    out = encode_context(epochs(), cfg, n_states=2)

    assert out["screen_x_typing"].iloc[0] == 50.0
    assert out["screen_x_typing"].iloc[2] == 0.0
    assert out["state_1_x_screen"].tolist() == [0, 1, 0, 0, 0, 1]
    assert out["state_1_x_task_coding"].tolist() == [0, 1, 0, 0, 0, 0]
