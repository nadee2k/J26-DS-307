import numpy as np

from src.evaluation.sequential_experiments import evaluate_hmm_augmentation
from src.models.dataset import build_session_dataset, select_features
from src.models.sequential import (
    DiscreteHMM,
    fit_discrete_hmm,
    sequence_feature_columns,
    session_hmm_features,
    state_sequences_by_session,
)


def _two_state_sequences(seed=0, n_sequences=10, length=80):
    """Generate sequences from a well-separated two-state HMM."""
    rng = np.random.default_rng(seed)
    transmat = np.array([[0.95, 0.05], [0.05, 0.95]])
    emission = np.array([[0.9, 0.1], [0.1, 0.9]])
    sequences = []
    for _ in range(n_sequences):
        state = int(rng.integers(0, 2))
        obs = []
        for _ in range(length):
            # emission[state, 0] is P(symbol 0); draw symbol 0 or 1.
            obs.append(0 if rng.random() < emission[state, 0] else 1)
            state = 0 if rng.random() < transmat[state, 0] else 1
        sequences.append(np.array(obs))
    return sequences


def _fit(sequences, n_hidden=2):
    return fit_discrete_hmm(sequences, n_hidden=n_hidden, n_symbols=2, seed=1, n_restarts=2, n_iter=40)


def test_hmm_probabilities_are_valid():
    model = _fit(_two_state_sequences())
    assert np.isclose(model.startprob_.sum(), 1.0)
    assert np.allclose(model.transmat_.sum(axis=1), 1.0)
    assert np.allclose(model.emission_.sum(axis=1), 1.0)


def test_hmm_recovers_separated_emissions():
    model = _fit(_two_state_sequences())
    # The two hidden states should specialise on different symbols.
    assert set(np.argmax(model.emission_, axis=1)) == {0, 1}
    # States should be reasonably persistent.
    assert np.all(np.diag(model.transmat_) > 0.5)


def test_hmm_likelihood_beats_uniform():
    sequences = _two_state_sequences()
    model = _fit(sequences)
    uniform = DiscreteHMM(n_hidden=2, n_symbols=2, seed=1)
    uniform._initialize(sequences)
    assert model.score(sequences) > uniform.score(sequences)


def test_decode_returns_valid_hidden_states():
    model = _fit(_two_state_sequences())
    decoded = model.decode(np.array([0, 0, 1, 1, 0, 0]))
    assert decoded.shape == (6,)
    assert set(np.unique(decoded)).issubset({0, 1})


def test_state_sequences_and_features(prepared):
    sequences = state_sequences_by_session(prepared["features"])
    assert sequences
    assert all(isinstance(key, tuple) and len(key) == 2 for key in sequences)
    assert all(isinstance(value, np.ndarray) for value in sequences.values())

    model = fit_discrete_hmm(list(sequences.values()), n_hidden=2, n_symbols=3, seed=1, n_restarts=1, n_iter=20)
    frame = session_hmm_features(sequences, model)
    for column in sequence_feature_columns(2):
        assert column in frame.columns
    assert len(frame) == sum(1 for value in sequences.values() if len(value) > 0)


def test_evaluate_hmm_augmentation_smoke(prepared):
    dataset, groups = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    dataset = dataset.dropna(subset=["concentration_label"])
    columns = select_features(groups, ["baseline", "temporal", "state", "transition", "context"])
    sequences = state_sequences_by_session(prepared["features"])
    results = evaluate_hmm_augmentation(
        dataset,
        sequences,
        columns,
        model_names=["random_forest"],
        n_hidden=2,
        hmm_restarts=1,
        hmm_iter=20,
        split_scheme="participant",
        n_splits=3,
    )
    assert not results.empty
    assert set(results["representation"]) == {"proposed", "proposed_hmm"}


def test_evaluate_hmm_state_representation_smoke(prepared):
    from src.evaluation.sequential_experiments import evaluate_hmm_state_representation

    dataset, groups = build_session_dataset(prepared["features"], prepared["tables"]["concentration_logs"])
    dataset = dataset.dropna(subset=["concentration_label"])
    results = evaluate_hmm_state_representation(
        dataset,
        prepared["features"],
        groups,
        state_sequences_by_session(prepared["features"]),
        model_names=["random_forest"],
        n_hidden=2,
        hmm_restarts=1,
        hmm_iter=20,
        split_scheme="participant",
        n_splits=3,
    )
    assert not results.empty
    assert set(results["representation"]) == {"kmeans_states", "hmm_states"}
