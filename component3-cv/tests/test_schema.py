"""JSON contract + schema validation."""

from __future__ import annotations

from component3.export_schema import validate_contract, window_to_contract, write_json_schema
from component3.scoring import heuristic_focus_score, score_window
from component3.types import WindowRecord


def _window(**kwargs) -> WindowRecord:
    defaults = dict(
        session_id="c3-P001-S0",
        participant_id="P001",
        cohort="screen",
        window_start="2026-03-01T12:00:00+00:00",
        window_end="2026-03-01T12:00:05+00:00",
        n_frames=15,
        face_present_ratio=1.0,
        face_valid_ratio=0.9,
        away_from_desk_ratio=0.0,
        blurred_ratio=0.0,
        occluded_ratio=0.0,
        glare_ratio=0.0,
        yaw_mean=2.0,
        yaw_std=1.0,
        pitch_mean=-4.0,
        pitch_std=1.0,
        roll_mean=0.0,
        roll_std=0.5,
        gaze_valid_ratio=0.8,
        off_screen_gaze_ratio=0.1,
        phone_present_ratio=0.0,
        phone_confidence_max=0.0,
        expression_valid_ratio=0.0,
        dominant_expression="unavailable",
        visual_focus_score=80.0,
        confidence=0.7,
        phone_detected=False,
    )
    defaults.update(kwargs)
    return WindowRecord(**defaults)


def test_contract_matches_schema(cfg: dict) -> None:
    rec = window_to_contract(_window())
    validate_contract(rec)
    assert rec["dominant_expression"] == "unavailable"
    assert rec["phone_detected"] is False


def test_heuristic_penalizes_phone_and_away(cfg: dict) -> None:
    clean_score, _ = heuristic_focus_score(_window(), cfg)
    phone_score, _ = heuristic_focus_score(_window(phone_present_ratio=1.0), cfg)
    away_score, _ = heuristic_focus_score(_window(away_from_desk_ratio=1.0), cfg)
    assert phone_score < clean_score
    assert away_score < clean_score
    assert 0 <= phone_score <= 100


def test_score_window_fills_fields(cfg: dict) -> None:
    w = score_window(_window(visual_focus_score=None, confidence=None), cfg)
    assert w.visual_focus_score is not None
    assert w.confidence is not None


def test_write_json_schema(tmp_path, cfg: dict) -> None:
    # write_json_schema uses load_config() by default; write to an explicit path
    out = tmp_path / "window_record.schema.json"
    path = write_json_schema(out)
    assert path.exists()
    assert "visual_focus_score" in path.read_text(encoding="utf-8")
