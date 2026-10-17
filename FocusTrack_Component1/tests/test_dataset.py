from src.models.dataset import (
    BINARY_LABEL_COL,
    LABEL_COL,
    build_session_dataset,
    select_features,
    session_concentration_labels,
)


def test_session_concentration_labels():
    import pandas as pd

    concentration = pd.DataFrame(
        [
            {"session_id": "s1", "level": 5},
            {"session_id": "s1", "level": 4},
            {"session_id": "s2", "level": 1},
        ]
    )
    labels = session_concentration_labels(concentration)
    row = labels.set_index("session_id").loc["s1"]
    assert row[LABEL_COL] == 5  # round(4.5) -> 5
    assert row[BINARY_LABEL_COL] == 1
    assert labels.set_index("session_id").loc["s2", BINARY_LABEL_COL] == 0


def test_build_session_dataset_one_row_per_session(prepared):
    dataset, groups = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    sessions = prepared["features"][["participant_id", "session_id"]].drop_duplicates()
    assert len(dataset) == len(sessions)
    assert LABEL_COL in dataset.columns
    assert set(groups) == {"baseline", "temporal", "state", "transition", "context"}
    assert groups["baseline"] and groups["transition"] and groups["context"]


def test_select_features_composes_groups(prepared):
    _, groups = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    baseline = select_features(groups, ["baseline"])
    proposed = select_features(groups, ["baseline", "temporal", "state", "transition", "context"])
    assert set(baseline).issubset(set(proposed))
    assert len(proposed) > len(baseline)
