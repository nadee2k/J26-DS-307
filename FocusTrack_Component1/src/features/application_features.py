import re

import pandas as pd

CATEGORY_RULES: list[tuple[str, re.Pattern]] = [
    ("code_editor", re.compile(r"visual studio code|vs code|vscode|pycharm|intellij|cursor|neovim|vim", re.I)),
    ("browser", re.compile(r"chrome|firefox|safari|edge|brave|chromium", re.I)),
    ("pdf_reader", re.compile(r"pdf|okular|evince|adobe acrobat|document viewer", re.I)),
    ("office", re.compile(r"libreoffice|word|excel|powerpoint|docs|sheets", re.I)),
    ("communication", re.compile(r"zoom|teams|slack|discord|meet", re.I)),
    ("terminal", re.compile(r"terminal|konsole|gnome-terminal|kitty|alacritty", re.I)),
]


def categorize_application(title: str | None) -> str:
    if not title or title == "Unknown":
        return "unknown"
    for category, pattern in CATEGORY_RULES:
        if pattern.search(str(title)):
            return category
    return "other"


def extract_application_features(window: pd.DataFrame, duration_seconds: float) -> dict:
    duration = max(duration_seconds, 1.0)
    titles = (
        window["active_application"].fillna("Unknown").astype(str)
        if "active_application" in window
        else pd.Series(dtype=str)
    )
    if titles.empty:
        return {
            "application_duration": duration,
            "application_switch_count": 0,
            "unique_application_count": 0,
            "application_switch_frequency": 0.0,
            "current_application_category": "unknown",
            "application_sequence": [],
        }
    switches = window["application_switched"].fillna(0).sum() if "application_switched" in window else 0
    categories = titles.map(categorize_application)
    dominant = categories.mode().iloc[0] if not categories.empty else "unknown"
    sequence = list(dict.fromkeys(categories.tolist()))
    return {
        "application_duration": duration,
        "application_switch_count": int(switches),
        "unique_application_count": int(titles.nunique()),
        "application_switch_frequency": float(switches / duration),
        "current_application_category": dominant,
        "application_sequence": sequence,
    }
