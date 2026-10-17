"""Sequential modelling of interaction states (proposal section 3.5).

A self-contained categorical Hidden Markov Model is fitted to the sequences of
discovered interaction states. The observed symbol alphabet is the set of
interaction states, while the hidden states represent underlying behavioural
regimes. Two uses are supported:

* descriptive analysis -- hidden-state transition structure and decoded regime
  sequences for reporting;
* fold-safe augmentation -- ``src.evaluation.sequential_experiments`` fits the
  HMM on training folds only and derives per-session features for the classifier,
  so no information leaks across validation splits.

Implemented with NumPy/SciPy (log-space Baum-Welch + Viterbi); no third-party
HMM dependency is required.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.special import logsumexp

from src.config import RANDOM_STATE, STATE_COL

EPS = 1e-12


def _log(values: np.ndarray) -> np.ndarray:
    return np.log(np.clip(values, EPS, None))


class DiscreteHMM:
    """Categorical HMM fitted with expectation-maximisation (Baum-Welch)."""

    def __init__(self, n_hidden: int, n_symbols: int, seed: int = RANDOM_STATE):
        self.n_hidden = int(n_hidden)
        self.n_symbols = int(n_symbols)
        self.seed = seed
        self.startprob_ = np.full(self.n_hidden, 1.0 / self.n_hidden)
        self.transmat_ = np.full((self.n_hidden, self.n_hidden), 1.0 / self.n_hidden)
        self.emission_ = None

    # -- initialisation -------------------------------------------------
    def _initialize(self, sequences: list[np.ndarray]) -> None:
        rng = np.random.default_rng(self.seed)
        # Sparse Dirichlet draws break the symmetric saddle point that a
        # uniform initialisation would otherwise fall into.
        self.startprob_ = rng.dirichlet(np.ones(self.n_hidden))
        self.transmat_ = np.stack(
            [rng.dirichlet(np.full(self.n_hidden, 0.5)) for _ in range(self.n_hidden)]
        )
        self.emission_ = np.stack(
            [rng.dirichlet(np.full(self.n_symbols, 0.5)) for _ in range(self.n_hidden)]
        )

    # -- inference ------------------------------------------------------
    def _forward(self, obs: np.ndarray, log_start, log_trans, log_emit) -> tuple[np.ndarray, float]:
        length = len(obs)
        log_alpha = np.empty((length, self.n_hidden))
        log_alpha[0] = log_start + log_emit[:, obs[0]]
        for t in range(1, length):
            log_alpha[t] = logsumexp(log_alpha[t - 1][:, None] + log_trans, axis=0) + log_emit[:, obs[t]]
        return log_alpha, float(logsumexp(log_alpha[-1]))

    def _backward(self, obs: np.ndarray, log_trans, log_emit) -> np.ndarray:
        length = len(obs)
        log_beta = np.zeros((length, self.n_hidden))
        for t in range(length - 2, -1, -1):
            log_beta[t] = logsumexp(
                log_trans + log_emit[:, obs[t + 1]][None, :] + log_beta[t + 1][None, :], axis=1
            )
        return log_beta

    def log_likelihood(self, obs: np.ndarray) -> float:
        if len(obs) == 0:
            return float("-inf")
        return self._forward(
            obs, _log(self.startprob_), _log(self.transmat_), _log(self.emission_)
        )[1]

    def score(self, sequences: list[np.ndarray]) -> float:
        return float(sum(self.log_likelihood(obs) for obs in sequences if len(obs) > 0))

    def decode(self, obs: np.ndarray) -> np.ndarray:
        """Viterbi decoding of the most likely hidden-state sequence."""
        if len(obs) == 0:
            return np.array([], dtype=int)
        log_start, log_trans, log_emit = _log(self.startprob_), _log(self.transmat_), _log(self.emission_)
        length = len(obs)
        delta = np.empty((length, self.n_hidden))
        psi = np.zeros((length, self.n_hidden), dtype=int)
        delta[0] = log_start + log_emit[:, obs[0]]
        for t in range(1, length):
            scores = delta[t - 1][:, None] + log_trans
            psi[t] = np.argmax(scores, axis=0)
            delta[t] = scores.max(axis=0) + log_emit[:, obs[t]]
        states = np.empty(length, dtype=int)
        states[-1] = int(np.argmax(delta[-1]))
        for t in range(length - 2, -1, -1):
            states[t] = psi[t + 1][states[t + 1]]
        return states

    # -- fitting --------------------------------------------------------
    def fit(self, sequences: list[np.ndarray], n_iter: int = 100, tol: float = 1e-4) -> "DiscreteHMM":
        usable = [np.asarray(obs, dtype=int) for obs in sequences if len(obs) > 0]
        self._initialize(usable)
        if not usable:
            return self

        previous = float("-inf")
        for _ in range(n_iter):
            accum_start = np.zeros(self.n_hidden)
            accum_trans = np.zeros((self.n_hidden, self.n_hidden))
            accum_emit = np.zeros((self.n_hidden, self.n_symbols))
            total = 0.0
            log_start, log_trans = _log(self.startprob_), _log(self.transmat_)
            log_emit = _log(self.emission_)

            for obs in usable:
                log_alpha, log_lik = self._forward(obs, log_start, log_trans, log_emit)
                log_beta = self._backward(obs, log_trans, log_emit)
                total += log_lik

                gamma = np.exp(log_alpha + log_beta - log_lik)
                accum_start += gamma[0]
                np.add.at(accum_emit.T, obs, gamma)

                if len(obs) > 1:
                    log_xi = (
                        log_alpha[:-1, :, None]
                        + log_trans[None, :, :]
                        + log_emit[:, obs[1:]].T[:, None, :]
                        + log_beta[1:, None, :]
                        - log_lik
                    )
                    accum_trans += np.exp(logsumexp(log_xi, axis=0))

            self.startprob_ = _normalise(accum_start)
            self.transmat_ = _normalise_rows(accum_trans)
            self.emission_ = _normalise_rows(accum_emit)

            if abs(total - previous) < tol:
                break
            previous = total
        return self

    # -- summaries ------------------------------------------------------
    def expected_dwell(self) -> np.ndarray:
        diagonal = np.clip(np.diag(self.transmat_), 0.0, 1.0 - EPS)
        return 1.0 / (1.0 - diagonal)

    def transition_frame(self, prefix: str = "hidden") -> pd.DataFrame:
        frame = pd.DataFrame(
            self.transmat_,
            index=[f"{prefix}_{i}" for i in range(self.n_hidden)],
            columns=[f"{prefix}_{i}" for i in range(self.n_hidden)],
        )
        return frame


def _normalise(values: np.ndarray) -> np.ndarray:
    total = values.sum()
    if total <= 0:
        return np.full(len(values), 1.0 / len(values))
    return values / total


def _normalise_rows(matrix: np.ndarray) -> np.ndarray:
    totals = matrix.sum(axis=1, keepdims=True)
    totals[totals <= 0] = 1.0
    return matrix / totals


def fit_discrete_hmm(
    sequences: list[np.ndarray],
    n_hidden: int = 3,
    n_symbols: int | None = None,
    n_iter: int = 100,
    tol: float = 1e-4,
    seed: int = RANDOM_STATE,
    n_restarts: int = 3,
) -> DiscreteHMM:
    usable = [np.asarray(obs, dtype=int) for obs in sequences if len(obs) > 0]
    if n_symbols is None:
        highest = max((int(obs.max()) for obs in usable), default=-1)
        n_symbols = max(highest + 1, 2)

    best: DiscreteHMM | None = None
    best_score = float("-inf")
    for restart in range(max(1, n_restarts)):
        model = DiscreteHMM(n_hidden=n_hidden, n_symbols=n_symbols, seed=seed + restart)
        model.fit(usable, n_iter=n_iter, tol=tol)
        score = model.score(usable)
        if score > best_score:
            best_score = score
            best = model
    assert best is not None
    return best


def state_sequences_by_session(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
) -> dict[tuple, np.ndarray]:
    """Return ``{(participant_id, session_id): ordered state array}``."""
    if features.empty or state_col not in features.columns:
        return {}
    ordered = features.sort_values(
        [c for c in ("participant_id", "session_id", "window_index") if c in features.columns]
    )
    sequences: dict[tuple, np.ndarray] = {}
    for (participant_id, session_id), group in ordered.groupby(
        ["participant_id", "session_id"], dropna=False, sort=False
    ):
        values = pd.to_numeric(group[state_col], errors="coerce").dropna().to_numpy(dtype=int)
        sequences[(participant_id, session_id)] = values
    return sequences


def session_hmm_features(
    sequences: dict[tuple, np.ndarray],
    model: DiscreteHMM,
    prefix: str = "hmm",
) -> pd.DataFrame:
    """Per-session features derived from a fitted HMM.

    These are computed with a model that the caller controls; for evaluation the
    model must be fitted on training sessions only.
    """
    rows = []
    mean_dwell = float(np.mean(model.expected_dwell()))
    for (participant_id, session_id), obs in sequences.items():
        if len(obs) == 0:
            continue
        hidden = model.decode(obs)
        row = {
            "participant_id": participant_id,
            "session_id": session_id,
            f"{prefix}__log_likelihood": model.log_likelihood(obs) / len(obs),
            f"{prefix}__mean_dwell": mean_dwell,
            f"{prefix}__transition_entropy": _sequence_entropy(hidden),
            f"{prefix}__dominant": int(np.bincount(hidden, minlength=model.n_hidden).argmax()),
        }
        shares = np.bincount(hidden, minlength=model.n_hidden)[: model.n_hidden] / len(hidden)
        for index, share in enumerate(shares):
            row[f"{prefix}__share_{index}"] = float(share)
        rows.append(row)
    return pd.DataFrame(rows)


def _sequence_entropy(values: np.ndarray) -> float:
    if len(values) < 2:
        return 0.0
    _, counts = np.unique(values, return_counts=True)
    probabilities = counts / counts.sum()
    return float(-(probabilities * np.log(probabilities)).sum())


def sequence_feature_columns(n_hidden: int, prefix: str = "hmm") -> list[str]:
    return [
        f"{prefix}__log_likelihood",
        f"{prefix}__mean_dwell",
        f"{prefix}__transition_entropy",
        f"{prefix}__dominant",
        *[f"{prefix}__share_{index}" for index in range(n_hidden)],
    ]
