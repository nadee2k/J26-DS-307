import numpy as np
import pandas as pd

from focustrack.states.sequences import build_sequences
from focustrack.transitions.build import attach_transition_features


def sequence(states, session="s1"):
    return pd.DataFrame(
        {
            "session_id": [session] * len(states),
            "participant_id": ["p1"] * len(states),
            "epoch_index": list(range(len(states))),
            "state": states,
        }
    )


def test_transition_features_by_hand():
    states = [0, 0, 1, 1, 0, 0, 0, 2, 0, 0, 0, 0]
    out = attach_transition_features(
        sequence(states), interruption_states={1, 2}, recovery_epochs=2, window=5
    )

    assert out["state_dwell"].tolist() == [1, 2, 1, 2, 1, 2, 3, 1, 1, 2, 3, 4]
    assert out["state_changes_5min"].tolist() == [0, 0, 1, 1, 2, 2, 1, 2, 2, 2, 2, 1]
    assert out["is_interruption"].tolist() == [0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0]

    # before the first interruption the gap is censored at the window
    assert out["time_since_interruption"].iloc[0] == 5
    assert out["interruption_censored"].iloc[0] == 1
    assert np.isnan(out["recovery_epochs"].iloc[0])

    # recovery after the interruption at index 3
    assert out["recovery_epochs"].iloc[4] == 1
    assert out["recovery_epochs"].iloc[5] == 2
    assert out["recovered"].iloc[4] == 0
    assert out["recovered"].iloc[5] == 1


def test_interruption_mask_overrides_state():
    seq = sequence([0, 0, 0, 0])
    seq["interruption"] = [0, 1, 0, 0]
    out = attach_transition_features(
        seq,
        interruption_states={0},
        interruption_mask="interruption",
        recovery_epochs=2,
    )

    assert out["is_interruption"].tolist() == [0, 1, 0, 0]
    assert out["recovery_epochs"].iloc[1] == 0
    assert out["recovery_epochs"].iloc[2] == 1
    assert out["recovery_epochs"].iloc[3] == 2
    assert out["recovered"].iloc[3] == 1


def test_sequences_split_on_gap():
    epochs = pd.DataFrame(
        {
            "session_id": ["s1"] * 5 + ["s2"] * 2,
            "participant_id": ["p1"] * 7,
            "epoch_index": [0, 1, 2, 5, 6, 0, 1],
            "a": [0, 1, 2, 3, 4, 5, 6],
            "b": [1, 1, 1, 1, 1, 1, 1],
        }
    )
    X, lengths, meta = build_sequences(epochs, ["a", "b"])

    assert lengths.tolist() == [3, 2, 2]
    assert X.shape == (7, 2)
    assert meta["epoch_index"].tolist() == [0, 1, 2, 5, 6, 0, 1]
