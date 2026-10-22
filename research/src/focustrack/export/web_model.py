"""Export a deployable C1 model for the PP1 web app (Phase 5).

The research evaluation uses the full HMM representation. The browser cannot
currently decode a Gaussian HMM, so this module exports a **deployable subset**:
the same six live features the app records, with 5-epoch smoothing and the
screen-mode interaction. It is trained by the research code and loaded by the
app; the app no longer fits its own model.

The full HMM model remains the one reported in the experiments; this export is
the bridge until the app calls a Python scoring endpoint (or ships the HMM).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import f1_score
from sklearn.preprocessing import StandardScaler

from focustrack.config import ROOT, Config
from focustrack.labels.probes import RatingNormaliser

FEATURE_NAMES = (
    "typing rate",
    "idle time",
    "app switching",
    "mouse activity",
    "typing rhythm variability",
    "corrections",
    "screen session",
    "typing (screen)",
    "idle (screen)",
    "switching (screen)",
)

FEATURE_SPEC = (
    {"name": "typingRate", "unit": "keys/min", "source": "typing_rate"},
    {"name": "idleRatio", "unit": "0-1", "source": "idle_ratio"},
    {"name": "switchRate", "unit": "switches/min", "source": "switch_rate"},
    {"name": "mouseSpeed/100", "unit": "100 px/s", "source": "mouse_speed_px_s/100"},
    {"name": "interKeyVar", "unit": "coefficient of variation", "source": "inter_key_cv"},
    {"name": "backspaceRatio", "unit": "0-1", "source": "backspace_ratio"},
)


@dataclass
class ExportedModel:
    w: list[float]
    mu: list[float]
    sg: list[float]
    metrics: dict
    rows: int


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _repo_relative(path: Path) -> str:
    try:
        return str(Path(path).resolve().relative_to(ROOT.parent))
    except ValueError:
        return str(path)


def build_live_rows(
    epochs: pd.DataFrame,
    probes: pd.DataFrame,
    sessions: pd.DataFrame,
    cfg: Config,
) -> pd.DataFrame:
    """Replicate ``c1RowsWith`` + ``c1Smooth`` from the web app in Python.

    For every probe and every epoch in the five minutes before it, average the
    last five epochs and label the row with the probe's learner-normalised
    rating. This is the same row construction the app uses for training and
    live scoring.
    """
    norm = RatingNormaliser("within_learner").fit(probes)
    probe_view = norm.transform(probes)
    mode = sessions.set_index("session_id")["study_mode"].to_dict()
    by_session = {
        sid: frame.sort_values("epoch_index")
        for sid, frame in epochs.groupby("session_id", sort=False)
    }

    rows = []
    for probe in probe_view.itertuples(index=False):
        session = by_session.get(probe.session_id)
        if session is None or session.empty:
            continue
        screen = 1 if mode.get(probe.session_id) == "screen" else 0
        indices = session["epoch_index"].to_numpy()
        for t in range(max(0, int(probe.epoch_index) - cfg.probe_window_epochs), int(probe.epoch_index)):
            window = session[(indices >= max(0, t - 4)) & (indices <= t)]
            if window.empty:
                continue
            mean = window[
                [
                    "typing_rate",
                    "idle_ratio",
                    "switch_rate",
                    "mouse_speed",
                    "inter_key_var",
                    "backspace_ratio",
                ]
            ].mean()
            typing = float(mean["typing_rate"])
            idle = float(mean["idle_ratio"])
            switching = float(mean["switch_rate"])
            x = [
                typing,
                idle,
                switching,
                float(mean["mouse_speed"]) / 100.0,
                float(mean["inter_key_var"]),
                float(mean["backspace_ratio"]),
                float(screen),
                screen * typing,
                screen * idle,
                screen * switching,
            ]
            rows.append(
                {
                    "participant_id": probe.participant_id,
                    "session_id": probe.session_id,
                    "epoch_index": t,
                    "x": x,
                    "focus_label": int(probe.rating_z > cfg.focus_z_threshold),
                }
            )
    if not rows:
        raise ValueError("no live rows were built; check the probes and epochs")
    return pd.DataFrame(rows)


def _fit(X: np.ndarray, y: np.ndarray, seed: int) -> tuple[LogisticRegression, StandardScaler]:
    scaler = StandardScaler().fit(X)
    classifier = LogisticRegression(
        max_iter=1000, class_weight="balanced", random_state=seed
    ).fit(scaler.transform(X), y)
    return classifier, scaler


def _lopo_macro_f1(rows: pd.DataFrame, seed: int) -> dict:
    scores = []
    for participant in sorted(rows["participant_id"].unique()):
        train = rows[rows["participant_id"] != participant]
        test = rows[rows["participant_id"] == participant]
        if train.empty or test.empty:
            continue
        X_train = np.vstack(train["x"].to_numpy())
        X_test = np.vstack(test["x"].to_numpy())
        y_train = train["focus_label"].to_numpy(dtype=int)
        y_test = test["focus_label"].to_numpy(dtype=int)
        if len(np.unique(y_train)) < 2:
            continue
        classifier, scaler = _fit(X_train, y_train, seed)
        probability = classifier.predict_proba(scaler.transform(X_test))[:, 1]
        scores.append(
            float(
                f1_score(
                    y_test, (probability >= 0.5).astype(int), average="macro", labels=[0, 1], zero_division=0
                )
            )
        )
    return {
        "lopo_macro_f1": float(np.mean(scores)) if scores else float("nan"),
        "participants": len(scores),
        "min_macro_f1": float(np.min(scores)) if scores else float("nan"),
        "max_macro_f1": float(np.max(scores)) if scores else float("nan"),
    }


def train_export_model(rows: pd.DataFrame, cfg: Config) -> ExportedModel:
    X = np.vstack(rows["x"].to_numpy())
    y = rows["focus_label"].to_numpy(dtype=int)
    classifier, scaler = _fit(X, y, cfg.seed)
    metrics = _lopo_macro_f1(rows, cfg.seed)
    return ExportedModel(
        w=[float(classifier.intercept_[0]), *classifier.coef_[0].astype(float).tolist()],
        mu=scaler.mean_.astype(float).tolist(),
        sg=scaler.scale_.astype(float).tolist(),
        metrics=metrics,
        rows=len(rows),
    )


def export_web_model(
    cfg: Config,
    epochs_path: Path,
    probes_path: Path,
    sessions_path: Path,
    output: Path,
    contract_path: Path,
    fixture_path: Path,
) -> dict:
    epochs = pd.read_csv(epochs_path)
    probes = pd.read_csv(probes_path)
    sessions = pd.read_csv(sessions_path)

    rows = build_live_rows(epochs, probes, sessions, cfg)
    model = train_export_model(rows, cfg)

    payload = {
        "version": "c1-web-1.0.0",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "trainedOn": (
            f"simulated study (seed {cfg.seed}, {rows['participant_id'].nunique()} participants, "
            f"{len(rows)} probe-labelled rows)"
        ),
        "dataSha256": _sha256(epochs_path),
        "labelRule": "learner-normalised probe rating z > 0, five-epoch smoothing",
        "features": list(FEATURE_SPEC),
        "model": {
            "names": list(FEATURE_NAMES),
            "w": model.w,
            "mu": model.mu,
            "sg": model.sg,
        },
        "evaluation": model.metrics,
        "notes": (
            "Deployable browser subset. The full HMM state/transition/context model is "
            "evaluated in research/; this export keeps the live feature contract."
        ),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    contract = {
        "version": payload["version"],
        "model": _repo_relative(output),
        "featureNames": list(FEATURE_NAMES),
        "featureSpec": list(FEATURE_SPEC),
        "smoothingWindow": cfg.probe_window_epochs,
        "vector": [
            "typingRate",
            "idleRatio",
            "switchRate",
            "mouseSpeed/100",
            "interKeyVar",
            "backspaceRatio",
            "screen",
            "screen*typingRate",
            "screen*idleRatio",
            "screen*switchRate",
        ],
        "threshold": 0.5,
        "trainedFrom": _repo_relative(epochs_path),
    }
    contract_path.parent.mkdir(parents=True, exist_ok=True)
    contract_path.write_text(json.dumps(contract, indent=2), encoding="utf-8")

    # golden fixture for the Python and JavaScript contract checks
    sample = rows.iloc[len(rows) // 2]
    expected = float(
        1.0
        / (
            1.0
            + np.exp(
                -(
                    model.w[0]
                    + sum(
                        model.w[j + 1]
                        * ((sample["x"][j] - model.mu[j]) / (model.sg[j] or 1.0))
                        for j in range(len(model.w) - 1)
                    )
                )
            )
        )
    )
    fixture = {
        "x": [float(v) for v in sample["x"]],
        "expectedProbability": expected,
        "tolerance": 1e-9,
    }
    fixture_path.parent.mkdir(parents=True, exist_ok=True)
    fixture_path.write_text(json.dumps(fixture, indent=2), encoding="utf-8")
    return payload
