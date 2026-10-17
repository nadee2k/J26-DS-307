import pandas as pd

from src.transitions.transition_model import (
    add_state_transitions,
    session_transition_summary,
    transition_probabilities,
)


def _frames(states):
    return pd.DataFrame(
        {
            "participant_id": ["p"] * len(states),
            "session_id": ["s"] * len(states),
            "context": ["coding"] * len(states),
            "window_index": list(range(len(states))),
            "interaction_state": states,
        }
    )


def test_state_duration_and_transitions():
    out = add_state_transitions(_frames([0, 0, 1, 1, 0, 2]))
    assert out["state_duration"].tolist() == [1, 2, 1, 2, 1, 1]
    assert out["is_transition"].tolist() == [False, False, True, False, True, True]
    assert out["transition_type"].iloc[0] == "start"
    assert out["transition_type"].iloc[4] == "1->0"
    assert out["interruption_count"].tolist() == [0, 0, 1, 1, 2, 3]
    assert out["state_change_rate"].iloc[-1] == 3 / 6


def test_recovery_count_detects_aba_pattern():
    out = add_state_transitions(_frames([0, 1, 0]))
    assert out["recovery_count"].tolist() == [0, 0, 1]


def test_transition_probabilities_normalise():
    probs = transition_probabilities(_frames([0, 0, 1, 1, 0, 2]))
    totals = probs.groupby("from_state")["probability"].sum()
    assert all(abs(value - 1.0) < 1e-9 for value in totals)


def test_session_transition_summary():
    summary = session_transition_summary(_frames([0, 0, 1, 1, 0, 2]))
    row = summary.iloc[0]
    assert row["n_transitions"] == 3
    assert row["n_runs"] == 4
    assert row["max_run_length"] == 2
