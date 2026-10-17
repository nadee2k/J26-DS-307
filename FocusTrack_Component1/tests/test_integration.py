import pandas as pd

from src.integration.export import (
    SESSION_OUTPUT_SCHEMA,
    WINDOW_OUTPUT_SCHEMA,
    build_outputs,
    build_session_output,
    build_window_output,
    save_outputs,
    session_behavioural_summary,
    validate_output,
)
from src.models.dataset import build_session_dataset


def test_window_output_schema(prepared):
    window = build_window_output(prepared["features"])
    assert not window.empty
    assert validate_output(window, WINDOW_OUTPUT_SCHEMA) == []


def test_session_output_schema_and_summary(prepared):
    dataset, _ = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    session = build_session_output(dataset)
    # Declared schema columns form a stable prefix; state shares follow.
    assert list(session.columns)[: len(SESSION_OUTPUT_SCHEMA)] == list(SESSION_OUTPUT_SCHEMA)
    assert validate_output(session, SESSION_OUTPUT_SCHEMA) == []
    assert session["behavioural_summary"].str.len().gt(0).all()


def test_predictions_are_attached(prepared):
    dataset, _ = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    predictions = dataset[["participant_id", "session_id"]].copy()
    predictions["y_pred"] = 4
    session = build_session_output(dataset, predictions=predictions)
    assert (session["predicted_label"] == 4).all()


def test_validate_output_detects_missing_columns():
    frame = pd.DataFrame({"session_id": ["a"], "interaction_state": [1]})
    problems = validate_output(frame, WINDOW_OUTPUT_SCHEMA)
    assert any("missing columns" in problem for problem in problems)


def test_behavioural_summary_is_readable():
    row = pd.Series(
        {
            "context": "coding",
            "dominant_state": 2,
            "session_duration_seconds": 600.0,
            "interruption_count": 4,
            "recovery_count": 2,
            "mean_state_duration": 3.5,
            "predicted_label": 5,
        }
    )
    summary = session_behavioural_summary(row)
    assert "Coding" in summary
    assert "state 2" in summary
    assert "level 5" in summary


def test_save_and_build_outputs(tmp_path, prepared):
    dataset, _ = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    outputs = build_outputs(prepared["features"], dataset)
    written = save_outputs(outputs, tmp_path)
    assert set(written) == {"behavioural_output_window", "behavioural_output_session"}
    for path in written.values():
        assert path.exists()
