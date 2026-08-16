"""§8 JSON integration contract: WindowRecord → public schema + JSON Schema file."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

from component3.config import load_config, resolve_path
from component3.types import WindowRecord

CONTRACT_VERSION = "1.0.0"

WINDOW_RECORD_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://focustrack.sliit.lk/schemas/component3/window_record.json",
    "title": "FocusTrack Component 3 window record",
    "description": (
        "Per-window visual contract consumed by the Signal Semantics Resolver "
        "and Components 1/2/4. Validity ratios distinguish 'no distraction' from 'couldn't tell'."
    ),
    "type": "object",
    "additionalProperties": False,
    "required": [
        "session_id",
        "window_start",
        "window_end",
        "visual_focus_score",
        "face_present_ratio",
        "gaze_valid_ratio",
        "off_screen_gaze_ratio",
        "phone_detected",
        "phone_detection_confidence",
        "expression_valid_ratio",
        "dominant_expression",
        "confidence",
    ],
    "properties": {
        "session_id": {"type": "string", "minLength": 1},
        "window_start": {"type": "string", "format": "date-time"},
        "window_end": {"type": "string", "format": "date-time"},
        "visual_focus_score": {"type": "number", "minimum": 0, "maximum": 100},
        "face_present_ratio": {"type": "number", "minimum": 0, "maximum": 1},
        "gaze_valid_ratio": {"type": "number", "minimum": 0, "maximum": 1},
        "off_screen_gaze_ratio": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
        "phone_detected": {"type": "boolean"},
        "phone_detection_confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "expression_valid_ratio": {"type": "number", "minimum": 0, "maximum": 1},
        "dominant_expression": {
            "type": "string",
            "enum": ["neutral", "focused", "confused", "bored", "unavailable"],
        },
        "confidence": {"type": "number", "minimum": 0, "maximum": 1},
        "contract_version": {"type": "string"},
        "participant_id": {"type": "string"},
        "cohort": {"type": "string", "enum": ["screen", "non_screen"]},
    },
}


def window_to_contract(window: WindowRecord) -> dict[str, Any]:
    score = window.visual_focus_score if window.visual_focus_score is not None else 0.0
    conf = window.confidence if window.confidence is not None else 0.0
    return {
        "session_id": window.session_id,
        "window_start": window.window_start,
        "window_end": window.window_end,
        "visual_focus_score": float(score),
        "face_present_ratio": float(window.face_present_ratio),
        "gaze_valid_ratio": float(window.gaze_valid_ratio),
        "off_screen_gaze_ratio": (
            None if window.off_screen_gaze_ratio is None else float(window.off_screen_gaze_ratio)
        ),
        "phone_detected": bool(window.phone_detected or window.phone_present_ratio > 0),
        "phone_detection_confidence": float(window.phone_confidence_max),
        "expression_valid_ratio": float(window.expression_valid_ratio),
        "dominant_expression": window.dominant_expression,
        "confidence": float(conf),
        "contract_version": CONTRACT_VERSION,
        "participant_id": window.participant_id,
        "cohort": window.cohort,
    }


def windows_to_contract(windows: Iterable[WindowRecord]) -> list[dict[str, Any]]:
    return [window_to_contract(w) for w in windows]


def write_session_export(windows: Iterable[WindowRecord], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        for rec in windows_to_contract(windows):
            fh.write(json.dumps(rec) + "\n")
    return path


def write_json_schema(path: Path | None = None) -> Path:
    cfg = load_config()
    schema_dir = resolve_path(cfg, "schema_dir") if path is None else Path(path).parent
    schema_dir.mkdir(parents=True, exist_ok=True)
    out = Path(path) if path else schema_dir / "window_record.schema.json"
    out.write_text(json.dumps(WINDOW_RECORD_SCHEMA, indent=2), encoding="utf-8")
    return out


def validate_contract(record: dict[str, Any]) -> None:
    from jsonschema import Draft202012Validator

    Draft202012Validator(WINDOW_RECORD_SCHEMA).validate(record)


def main(argv: list[str] | None = None) -> int:
    out = write_json_schema()
    print(f"Wrote JSON Schema to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
