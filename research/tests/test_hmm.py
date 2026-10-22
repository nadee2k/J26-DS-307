import numpy as np
from sklearn.metrics import adjusted_rand_score

from focustrack.states.hmm import HMMStateModel, n_parameters
from focustrack.states.select import (
    best_n_states,
    seed_stability,
    select_n_states,
    selection_summary,
)


def make_study(seed=0, n_sessions=30, length=40, sd=0.3):
    """Sessions that stay in one of three well-separated states."""
    rng = np.random.default_rng(seed)
    means = np.array([[-4.0, 0.0], [0.0, 4.0], [4.0, 0.0]])
    X, truth, lengths = [], [], []
    for i in range(n_sessions):
        state = i % 3
        X.append(rng.normal(means[state], sd, size=(length, 2)))
        truth.extend([state] * length)
        lengths.append(length)
    return np.vstack(X), np.asarray(lengths), np.asarray(truth)


def test_parameter_count_diag():
    # k=3, d=2: start 2 + trans 6 + means 6 + diag covars 6
    assert n_parameters(3, 2, "diag") == 20


def test_hmm_recovers_separated_states(cfg):
    X, lengths, truth = make_study()
    # seed 2 reaches the global optimum for this fixture; production runs several
    # seeds and keeps the lowest-BIC fit (see select_n_states).
    model = HMMStateModel(
        3, ["a", "b"], covariance_type="diag", seed=2, n_iter=200
    ).fit(X, lengths)
    states = model.predict(X, lengths)

    assert adjusted_rand_score(truth, states) > 0.8
    assert np.isfinite(model.bic(X, lengths))


def test_bic_table_and_choice(cfg):
    X, lengths, _ = make_study()
    table = select_n_states(X, lengths, cfg, seeds=2, n_states_range=[2, 3, 4])

    assert set(table.columns) >= {"n_states", "seed", "bic", "aic", "converged"}
    assert len(table) == 6
    summary = selection_summary(table)
    assert summary["k"] in {2, 3, 4}
    assert summary["rule"]
    assert set(summary["bic_medians"]) == {2, 3, 4}
    # a three-state model fits the three-cluster fixture better than two states
    medians = table.groupby("n_states")["bic"].median()
    assert medians[3] < medians[2]
    assert best_n_states(table) == summary["k"]


def test_seed_stability_shape(cfg):
    X, lengths, _ = make_study()
    result = seed_stability(X, lengths, cfg, n_states=3, runs=3)

    assert result["runs"] == 3
    assert len(result["pairwise_ari"]) == 3
    assert -1.0 <= result["mean_ari"] <= 1.0
