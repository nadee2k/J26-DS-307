"""State-count selection (BIC) and seed stability (proposal SO3)."""

from __future__ import annotations

from itertools import combinations

import numpy as np
import pandas as pd
from sklearn.metrics import adjusted_rand_score

from focustrack.config import Config
from focustrack.states.hmm import HMMStateModel


def _settings(cfg: Config) -> dict:
    states = cfg.states or {}
    return {
        "n_states_range": list(states.get("n_states_range", [2, 3, 4, 5, 6])),
        "runs": int(states.get("seed_stability_runs", 5)),
        "covariance_type": str(states.get("covariance_type", "diag")),
        "n_iter": int(states.get("n_iter", 200)),
        "tol": float(states.get("tol", 1e-4)),
    }


def select_n_states(
    X: np.ndarray,
    lengths: np.ndarray,
    cfg: Config,
    seeds: int | None = None,
    n_states_range: list[int] | None = None,
) -> pd.DataFrame:
    """Fit every candidate state count across seeds and report BIC/AIC.

    ``X`` must contain training participants only. The scaler is fitted inside
    each candidate fit, so selection is part of the training fold in evaluation.
    """
    settings = _settings(cfg)
    seeds = seeds or settings["runs"]
    candidates = list(n_states_range or settings["n_states_range"])
    rows: list[dict] = []

    for n_states in candidates:
        for seed in range(seeds):
            row: dict = {"n_states": n_states, "seed": seed}
            try:
                model = HMMStateModel(
                    n_states=n_states,
                    feature_names=list(cfg.state_features),
                    covariance_type=settings["covariance_type"],
                    seed=seed,
                    n_iter=settings["n_iter"],
                    tol=settings["tol"],
                ).fit(X, lengths)
                row.update(
                    {
                        "log_likelihood": model.log_likelihood(X, lengths),
                        "bic": model.bic(X, lengths),
                        "aic": model.aic(X, lengths),
                        "converged": model.converged,
                        "error": "",
                    }
                )
            except Exception as exc:  # hmmlearn can fail on degenerate folds
                row.update(
                    {
                        "log_likelihood": np.nan,
                        "bic": np.nan,
                        "aic": np.nan,
                        "converged": False,
                        "error": str(exc)[:200],
                    }
                )
            rows.append(row)

    return pd.DataFrame(rows)


def best_n_states(table: pd.DataFrame) -> int:
    """State count with the lowest median BIC across seeds."""
    return int(selection_summary(table)["k"])


def selection_summary(table: pd.DataFrame, min_gain_fraction: float = 0.10) -> dict:
    """Choose the state count, falling back to an elbow rule when BIC is monotonic.

    BIC often keeps decreasing as states are added on large continuous datasets.
    When there is no interior minimum, take the smallest k after which adding
    another state improves the median BIC by less than ``min_gain_fraction`` of
    the total improvement. The full curve is reported either way.
    """
    valid = table.dropna(subset=["bic"])
    if valid.empty:
        raise RuntimeError("every candidate state count failed to fit")

    medians = valid.groupby("n_states")["bic"].median().sort_index()
    counts = medians.index.tolist()
    values = medians.to_numpy(dtype=float)
    summary = {
        "k": int(counts[0]),
        "rule": "single candidate",
        "bic_medians": {int(k): float(v) for k, v in zip(counts, values)},
        "min_gain_fraction": min_gain_fraction,
    }
    if len(counts) == 1:
        return summary

    interior = [
        i for i in range(1, len(values) - 1)
        if values[i] < values[i - 1] and values[i] < values[i + 1]
    ]
    if interior:
        best = min(interior, key=lambda i: values[i])
        summary.update({"k": int(counts[best]), "rule": "interior BIC minimum"})
        return summary

    gains = values[:-1] - values[1:]
    total = float(values[0] - values[-1])
    if total <= 0:
        summary.update({"k": int(counts[0]), "rule": "BIC did not improve with more states"})
        return summary

    fractions = gains / total
    index = next(
        (i for i, gain in enumerate(fractions) if gain < min_gain_fraction),
        len(counts) - 2,
    )
    summary.update(
        {
            "k": int(counts[index]),
            "rule": (
                "elbow: adding the next state improves median BIC by less than "
                f"{min_gain_fraction:.0%} of the total gain"
            ),
            "marginal_gain_fraction": {int(counts[i + 1]): float(fractions[i]) for i in range(len(fractions))},
        }
    )
    return summary


def best_fit_row(table: pd.DataFrame, n_states: int) -> pd.Series:
    """Lowest-BIC seed for the chosen state count."""
    rows = table[(table["n_states"] == n_states)].dropna(subset=["bic"])
    if rows.empty:
        raise RuntimeError(f"no successful fit for {n_states} states")
    return rows.sort_values("bic").iloc[0]


def seed_stability(
    X: np.ndarray,
    lengths: np.ndarray,
    cfg: Config,
    n_states: int,
    runs: int | None = None,
) -> dict:
    """Pairwise agreement (adjusted Rand index) of state assignments across seeds."""
    settings = _settings(cfg)
    runs = runs or settings["runs"]
    assignments: list[np.ndarray] = []
    for seed in range(runs):
        model = HMMStateModel(
            n_states=n_states,
            feature_names=list(cfg.state_features),
            covariance_type=settings["covariance_type"],
            seed=seed,
            n_iter=settings["n_iter"],
            tol=settings["tol"],
        ).fit(X, lengths)
        assignments.append(model.predict(X, lengths))

    scores = [
        float(adjusted_rand_score(assignments[i], assignments[j]))
        for i, j in combinations(range(len(assignments)), 2)
    ]
    return {
        "runs": runs,
        "mean_ari": float(np.mean(scores)) if scores else float("nan"),
        "min_ari": float(np.min(scores)) if scores else float("nan"),
        "pairwise_ari": scores,
    }
