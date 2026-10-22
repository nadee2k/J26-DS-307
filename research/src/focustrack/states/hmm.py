"""Gaussian hidden Markov model for interaction states (proposal SO3, 3.4.4).

The HMM is fitted on standardised epoch features from training participants
only. Sequences are passed as one array plus ``lengths`` so that session
boundaries do not create artificial transitions.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from hmmlearn.hmm import GaussianHMM
from sklearn.preprocessing import StandardScaler


def n_parameters(n_states: int, n_features: int, covariance_type: str = "diag") -> int:
    """Free parameters of a Gaussian HMM, used for the BIC penalty."""
    start = n_states - 1
    transitions = n_states * (n_states - 1)
    means = n_states * n_features
    if covariance_type == "diag":
        covariance = n_states * n_features
    elif covariance_type == "full":
        covariance = n_states * n_features * (n_features + 1) // 2
    elif covariance_type == "spherical":
        covariance = n_states
    elif covariance_type == "tied":
        covariance = n_features * (n_features + 1) // 2
    else:
        raise ValueError(f"unknown covariance_type {covariance_type!r}")
    return start + transitions + means + covariance


@dataclass
class HMMStateModel:
    """Scaler + Gaussian HMM fitted as one object."""

    n_states: int
    feature_names: list[str]
    covariance_type: str = "diag"
    seed: int = 0
    n_iter: int = 200
    tol: float = 1e-4
    scaler: StandardScaler = field(default_factory=StandardScaler)
    model: GaussianHMM | None = None
    labels: list[str] = field(default_factory=list)

    def fit(self, X: np.ndarray, lengths: np.ndarray) -> "HMMStateModel":
        X = np.asarray(X, dtype=float)
        if X.ndim != 2:
            raise ValueError("X must be a 2-D array")
        if len(lengths) == 0 or int(np.sum(lengths)) != len(X):
            raise ValueError("lengths must sum to the number of rows in X")
        if self.n_states > len(X):
            raise ValueError("n_states cannot exceed the number of epochs")

        self.scaler.fit(X)
        scaled = self.scaler.transform(X)
        self.model = GaussianHMM(
            n_components=self.n_states,
            covariance_type=self.covariance_type,
            n_iter=self.n_iter,
            tol=self.tol,
            random_state=self.seed,
            init_params="kmeans",
        )
        self.model.fit(scaled, lengths)
        return self

    @property
    def converged(self) -> bool:
        return bool(self.model is not None and self.model.monitor_.converged)

    def _check_fitted(self) -> None:
        if self.model is None:
            raise RuntimeError("call fit() before using the state model")

    def log_likelihood(self, X: np.ndarray, lengths: np.ndarray) -> float:
        self._check_fitted()
        return float(self.model.score(self.scaler.transform(np.asarray(X, dtype=float)), lengths))

    def bic(self, X: np.ndarray, lengths: np.ndarray) -> float:
        X = np.asarray(X, dtype=float)
        n = len(X)
        return -2.0 * self.log_likelihood(X, lengths) + n_parameters(
            self.n_states, X.shape[1], self.covariance_type
        ) * np.log(max(n, 2))

    def aic(self, X: np.ndarray, lengths: np.ndarray) -> float:
        X = np.asarray(X, dtype=float)
        return -2.0 * self.log_likelihood(X, lengths) + 2 * n_parameters(
            self.n_states, X.shape[1], self.covariance_type
        )

    def predict(self, X: np.ndarray, lengths: np.ndarray) -> np.ndarray:
        self._check_fitted()
        return self.model.predict(self.scaler.transform(np.asarray(X, dtype=float)), lengths)

    def predict_proba(self, X: np.ndarray, lengths: np.ndarray) -> np.ndarray:
        self._check_fitted()
        return self.model.predict_proba(self.scaler.transform(np.asarray(X, dtype=float)), lengths)

    def transition_matrix(self) -> pd.DataFrame:
        self._check_fitted()
        return pd.DataFrame(
            self.model.transmat_,
            index=[f"from_{s}" for s in range(self.n_states)],
            columns=[f"to_{s}" for s in range(self.n_states)],
        )

    def state_means(self, X: np.ndarray, states: np.ndarray) -> pd.DataFrame:
        """Mean raw feature values per discovered state."""
        X = np.asarray(X, dtype=float)
        rows = []
        for state in range(self.n_states):
            mask = states == state
            row: dict[str, float | int] = {
                "state": state,
                "epochs": int(mask.sum()),
                "share": float(mask.mean()) if len(mask) else 0.0,
            }
            for j, name in enumerate(self.feature_names):
                row[name] = float(X[mask, j].mean()) if mask.any() else np.nan
            rows.append(row)
        return pd.DataFrame(rows)
