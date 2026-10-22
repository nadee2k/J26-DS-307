"""Application features: switching and category entropy (proposal 3.4.3, SO2)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from focustrack.config import Config

BROWSERS = ("chrome", "firefox", "edge", "safari", "brave", "opera")


def categorise_app(app: str | None, task: str, cfg: Config) -> str:
    """Map an application name to the proposal's coarse category.

    A browser is labelled ``browser_learning`` for assignment/lecture sessions
    and ``browser_other`` otherwise; the app name alone cannot tell us what the
    page was. The rule is documented in ``docs/DECISIONS.md``.
    """
    if not app:
        return "other"
    name = str(app).lower()
    for category, tokens in cfg.app_categories.items():
        if any(token in name for token in tokens):
            return category
    if any(browser in name for browser in BROWSERS):
        return "browser_learning" if task in {"assignment", "zoom"} else "browser_other"
    return "other"


def entropy(categories: list[str]) -> float:
    """Shannon entropy in bits. ``NaN`` when there is nothing to summarise."""
    if not categories:
        return float("nan")
    counts = pd.Series(categories).value_counts(normalize=True).to_numpy()
    return float(-(counts * np.log2(counts)).sum())


def app_features(
    events: pd.DataFrame,
    start: float,
    end: float,
    task: str,
    cfg: Config,
) -> dict[str, float]:
    """Switch rate, distinct applications and category entropy for one epoch."""
    duration = max(end - start, 1e-9)
    window = events[(events["t"] >= start) & (events["t"] < end)]

    switches = window[window["kind"] == "switch"]
    if switches.empty:
        # browser-only mode reports leaving/returning instead of app switches
        switches = window[window["kind"] == "leave"]

    n_switches = int(len(switches))
    apps = [str(a) for a in switches["app"].dropna().tolist()]
    categories = [categorise_app(app, task, cfg) for app in apps]

    return {
        "switch_rate": n_switches / (duration / 60.0),
        "unique_apps": float(len(set(apps))),
        "app_category_entropy": entropy(categories),
    }
