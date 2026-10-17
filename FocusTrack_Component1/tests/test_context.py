from src.config import CONTEXT_CODES
from src.context.context_model import (
    add_context_features,
    context_effect_analysis,
    context_state_distribution,
)


def test_add_context_features_codes_context(prepared):
    features = add_context_features(prepared["features"], n_states=3)
    assert "context_code" in features.columns
    assert "context_state_id" in features.columns
    known = features["context"].isin(CONTEXT_CODES)
    assert (features.loc[known, "context_code"].notna()).all()


def test_context_state_distribution_sums_to_one(prepared):
    features = add_context_features(prepared["features"], n_states=3)
    distribution = context_state_distribution(features)
    if not distribution.empty:
        totals = distribution.sum(axis=1)
        assert all(abs(value - 1.0) < 1e-9 for value in totals)


def test_context_effect_analysis_uses_labels(prepared):
    features = add_context_features(prepared["features"], n_states=3)
    analysis = context_effect_analysis(features)
    assert not analysis.empty
    assert "context" in analysis.columns
    assert analysis["n_windows"].sum() == len(features)
