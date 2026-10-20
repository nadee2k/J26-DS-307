"""Tests for artifact persistence, including the per-source redirect."""

import json


def test_artifacts_root_redirects_every_artifact(tmp_path, synthetic_tables):
    from src.pipeline import run_pipeline

    bundle = run_pipeline(
        synthetic_tables,
        window_seconds=60,
        n_states=3,
        n_hidden=2,
        save=True,
        run_ml=False,
        run_hmm=False,
        artifacts_root=tmp_path,
    )

    for relative in (
        "processed/events.csv",
        "features/features.csv",
        "features/state_profiles.csv",
        "features/session_dataset.csv",
        "sequences/state_sequences.csv",
        "results/state_quality.json",
        "results/integration_validation.json",
        "results/run_manifest.json",
        "results/integration/behavioural_output_session.csv",
        "models/state_model.joblib",
    ):
        assert (tmp_path / relative).exists(), f"missing {relative}"

    manifest = json.loads((tmp_path / "results/run_manifest.json").read_text(encoding="utf-8"))
    assert manifest["params"]["window_seconds"] == 60
    assert manifest["params"]["events"] == len(bundle["events"])
    assert manifest["params"]["windows"] == len(bundle["features"])
    assert manifest["duration_seconds"] is not None


def test_default_layout_is_used_without_a_root(tmp_path, monkeypatch, synthetic_tables):
    """Without an explicit root, artifacts follow the default ``data/`` layout.

    The default directories are redirected to a temporary tree before the run so
    the test never overwrites the real (git-ignored) ``data/`` artifacts.
    """
    import src.pipeline as pipeline
    from src.config import RESULTS_DIR
    from src.pipeline import run_pipeline

    # No root given -> the layout comes straight from src.config.
    assert pipeline.artifact_dirs()["results"] == RESULTS_DIR

    for name in ("processed", "features", "sequences", "results", "models"):
        monkeypatch.setattr(pipeline, f"{name.upper()}_DIR", tmp_path / name)

    bundle = run_pipeline(
        synthetic_tables,
        window_seconds=60,
        n_states=3,
        save=True,
        run_ml=False,
        run_hmm=False,
    )
    assert bundle["artifacts"]["state_quality"] == tmp_path / "results" / "state_quality.json"
    assert (tmp_path / "features" / "features.csv").exists()
