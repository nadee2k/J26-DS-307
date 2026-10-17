import pandas as pd

from src.states.state_analysis import describe_states
from src.states.state_discovery import discover_states
from src.states.state_validation import cluster_quality


def test_discover_states_assigns_labels(prepared):
    features = prepared["features"]
    assert "interaction_state" in features.columns
    n_states = features["interaction_state"].nunique()
    assert 2 <= n_states <= 3


def test_describe_states_profiles(prepared):
    profile = describe_states(prepared["features"])
    assert not profile.empty
    assert {"state", "n_windows"}.issubset(profile.columns)
    assert profile["n_windows"].sum() == len(prepared["features"])


def test_discover_states_handles_empty():
    out, model, scaler, cols = discover_states(pd.DataFrame(), n_states=3)
    assert "interaction_state" in out.columns
    assert model is None


def test_cluster_quality_reports_metrics(prepared):
    quality = cluster_quality(prepared["features"])
    assert set(quality) == {"silhouette", "davies_bouldin", "calinski_harabasz"}
    assert quality["silhouette"] is not None
