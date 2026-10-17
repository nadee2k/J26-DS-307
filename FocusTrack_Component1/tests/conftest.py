"""Shared pytest fixtures for the FocusTrack Component 1 test suite."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.simulation import generate_synthetic_tables  # noqa: E402


@pytest.fixture(scope="session")
def synthetic_tables():
    return generate_synthetic_tables(
        n_participants=12,
        sessions_per_participant=3,
        duration_seconds=600,
        seed=7,
    )


@pytest.fixture(scope="session")
def prepared(synthetic_tables):
    from src.pipeline import prepare_features

    return prepare_features(synthetic_tables, window_seconds=60, n_states=3)
