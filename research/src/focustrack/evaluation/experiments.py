"""Experiment grid: LOPO, leave-one-task-out, ablation and paired statistics.

The protocol follows proposal 3.8:

* every fold refits the scaler, HMM, state labels and imputation medians on the
  training side only;
* LOPO holds out one participant;
* LOTO holds out one computer-based task and trains on the others;
* Macro-F1 is compared across participants with a paired Wilcoxon test.
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from focustrack.config import ALL_TASKS, Config
from focustrack.evaluation.metrics import classification_metrics
from focustrack.evaluation.splits import leave_one_task_out, lopo
from focustrack.evaluation.statistics import compare_paired
from focustrack.labels.probes import RatingNormaliser, label_epochs
from focustrack.models.registry import build_classifier
from focustrack.pipeline.fold import build_representation, enrich_fold

BASELINE_VARIANT = {
    "aggregated": True,
    "temporal": False,
    "states": False,
    "transitions": False,
    "context": False,
}
ABLATION_MODEL = "svm"


DEFAULT_ABLATIONS = {
    "no_context": {"context": False},
    "no_states": {"states": False, "transitions": False},
    "no_transitions": {"transitions": False},
}


def representation_variants(cfg: Config) -> dict[str, dict[str, bool]]:
    variants = {
        "baseline": dict(BASELINE_VARIANT),
        "proposed": {**BASELINE_VARIANT, **cfg.representation},
    }
    ablations = cfg.ablations or DEFAULT_ABLATIONS
    for name, override in ablations.items():
        if name in {"full", "baseline"}:
            continue
        variants[name] = {**variants["proposed"], **override}
    return variants


def _labels_for_side(
    epochs: pd.DataFrame,
    probes: pd.DataFrame,
    cfg: Config,
    normaliser: RatingNormaliser | None,
) -> tuple[pd.DataFrame, RatingNormaliser]:
    if probes.empty:
        raise ValueError("no probes on this side of the fold")
    norm = normaliser or RatingNormaliser(cfg.label_normalisation).fit(probes)
    return label_epochs(epochs, probes, cfg, normaliser=norm), norm


def _run_fold(
    train_epochs: pd.DataFrame,
    test_epochs: pd.DataFrame,
    train_probes: pd.DataFrame,
    test_probes: pd.DataFrame,
    cfg: Config,
    n_states: int,
    variants: dict[str, dict[str, bool]],
    models: list[str],
    split: str,
    fold: str,
    participant: str | None,
    ablation_model: str = ABLATION_MODEL,
) -> tuple[list[dict], list[pd.DataFrame], dict]:
    norm = RatingNormaliser(cfg.label_normalisation).fit(train_probes)
    train_lab, _ = _labels_for_side(train_epochs, train_probes, cfg, norm)
    test_lab, _ = _labels_for_side(test_epochs, test_probes, cfg, norm)

    enriched = enrich_fold(train_epochs, test_epochs, cfg, n_states=n_states, seed=cfg.seed)
    keys = ["session_id", "participant_id", "epoch_index"]
    train = enriched.train.drop(columns=["focus_label"], errors="ignore").merge(
        train_lab[[*keys, "focus_label"]], on=keys, how="inner", validate="one_to_one"
    )
    test = enriched.test.drop(columns=["focus_label"], errors="ignore").merge(
        test_lab[[*keys, "focus_label"]], on=keys, how="inner", validate="one_to_one"
    )
    if train.empty or test.empty:
        raise ValueError("a side of the fold has no labelled epochs")

    rows: list[dict] = []
    predictions: list[pd.DataFrame] = []
    for variant_name, variant in variants.items():
        X_train, X_test, y_train, y_test, features = build_representation(
            train, test, cfg, n_states=n_states, variant=variant
        )
        allowed = models if variant_name in {"baseline", "proposed"} else [ablation_model]
        for model_name in allowed:
            row = {
                "split": split,
                "fold": fold,
                "participant": participant,
                "representation": variant_name,
                "model": model_name,
                "n_features": len(features),
                "n_train": int(len(y_train)),
                "n_test": int(len(y_test)),
                "state_labels": " | ".join(enriched.info["state_labels"]),
                "hmm_converged": enriched.info["converged"],
            }
            try:
                clf = build_classifier(model_name, seed=cfg.seed, y=y_train)
                clf.fit(X_train, y_train)
                probability = clf.predict_proba(X_test)[:, 1]
            except Exception as exc:  # a degenerate fold should not kill the run
                row.update({key: np.nan for key in (
                    "macro_f1", "balanced_accuracy", "accuracy", "macro_precision",
                    "macro_recall", "roc_auc", "prevalence",
                )})
                row["error"] = str(exc)[:200]
                rows.append(row)
                continue

            metrics = classification_metrics(y_test, probability)
            row.update(metrics)
            rows.append(row)
            predictions.append(
                pd.DataFrame(
                    {
                        **{key: test[key].to_numpy() for key in keys},
                        "study_mode": test["study_mode"].to_numpy(),
                        "task": test["task"].to_numpy(),
                        "y_true": y_test,
                        "y_prob": probability,
                        "split": split,
                        "fold": fold,
                        "representation": variant_name,
                        "model": model_name,
                    }
                )
            )
    return rows, predictions, enriched.info


def run_lopo(
    features: pd.DataFrame,
    probes: pd.DataFrame,
    cfg: Config,
    n_states: int,
    models: list[str],
    variants: dict[str, dict[str, bool]],
    max_folds: int | None = None,
    ablation_model: str = ABLATION_MODEL,
) -> tuple[list[dict], list[pd.DataFrame]]:
    rows: list[dict] = []
    predictions: list[pd.DataFrame] = []
    folds = lopo(features["participant_id"].unique())
    for train_pids, test_pids in folds[:max_folds]:
        train = features[features["participant_id"].isin(train_pids)]
        test = features[features["participant_id"].isin(test_pids)]
        train_probes = probes[probes["participant_id"].isin(train_pids)]
        test_probes = probes[probes["participant_id"].isin(test_pids)]
        fold_rows, fold_preds, _ = _run_fold(
            train,
            test,
            train_probes,
            test_probes,
            cfg,
            n_states,
            variants,
            models,
            split="lopo",
            fold=str(test_pids[0]),
            participant=str(test_pids[0]),
            ablation_model=ablation_model,
        )
        rows.extend(fold_rows)
        predictions.extend(fold_preds)
    return rows, predictions


def run_loto(
    features: pd.DataFrame,
    probes: pd.DataFrame,
    cfg: Config,
    n_states: int,
    models: list[str],
    variants: dict[str, dict[str, bool]],
    max_folds: int | None = None,
    ablation_model: str = ABLATION_MODEL,
) -> tuple[list[dict], list[pd.DataFrame]]:
    sessions = features[["session_id", "study_mode", "task"]].drop_duplicates()
    rows: list[dict] = []
    predictions: list[pd.DataFrame] = []
    folds = leave_one_task_out(sessions, tasks=tuple(ALL_TASKS[:4]))
    for train_sessions, test_sessions, task in folds[:max_folds]:
        train = features[features["session_id"].isin(train_sessions)]
        test = features[features["session_id"].isin(test_sessions)]
        train_probes = probes[probes["session_id"].isin(train_sessions)]
        test_probes = probes[probes["session_id"].isin(test_sessions)]
        if test_probes.empty:
            continue
        fold_rows, fold_preds, _ = _run_fold(
            train,
            test,
            train_probes,
            test_probes,
            cfg,
            n_states,
            variants,
            models,
            split="loto",
            fold=f"loto:{task}",
            participant=None,
            ablation_model=ablation_model,
        )
        rows.extend(fold_rows)
        predictions.extend(fold_preds)
    return rows, predictions


def summarise(
    rows: list[dict],
    predictions: list[pd.DataFrame],
    cfg: Config,
) -> dict[str, pd.DataFrame]:
    metrics = pd.DataFrame(rows)
    frames: dict[str, pd.DataFrame] = {"metrics": metrics}
    if metrics.empty:
        return frames

    summary = (
        metrics.groupby(["split", "representation", "model"], dropna=False)
        .agg(
            folds=("fold", "nunique"),
            macro_f1=("macro_f1", "mean"),
            balanced_accuracy=("balanced_accuracy", "mean"),
            accuracy=("accuracy", "mean"),
            roc_auc=("roc_auc", "mean"),
        )
        .reset_index()
    )
    frames["summary"] = summary

    lopo = metrics[metrics["split"] == "lopo"]
    if not lopo.empty:
        frames["per_participant"] = lopo[
            [
                "participant",
                "representation",
                "model",
                "macro_f1",
                "balanced_accuracy",
                "accuracy",
                "roc_auc",
                "n_test",
            ]
        ].copy()

        stats_rows: list[dict] = []
        for model in sorted(lopo["model"].unique()):
            subset = lopo[lopo["model"] == model]
            representations = set(subset["representation"].unique())
            if {"baseline", "proposed"} <= representations:
                result = compare_paired(
                    subset, "participant", "macro_f1", "baseline", "proposed"
                )
                result.update({"model": model, "contrast": "proposed_vs_baseline"})
                stats_rows.append(result)
            if "proposed" in representations:
                for ablation in ("no_context", "no_states", "no_transitions"):
                    if ablation in representations:
                        result = compare_paired(
                            subset, "participant", "macro_f1", ablation, "proposed"
                        )
                        result.update({"model": model, "contrast": f"proposed_vs_{ablation}"})
                        stats_rows.append(result)
        frames["statistics"] = pd.DataFrame(stats_rows)

    if predictions:
        predictions_frame = pd.concat(predictions, ignore_index=True)
        frames["predictions"] = predictions_frame

        by_mode_rows: list[dict] = []
        for (split, representation, model, mode), group in predictions_frame.groupby(
            ["split", "representation", "model", "study_mode"], dropna=False
        ):
            result = classification_metrics(group["y_true"], group["y_prob"])
            by_mode_rows.append(
                {
                    "split": split,
                    "representation": representation,
                    "model": model,
                    "study_mode": mode,
                    **result,
                }
            )
        frames["by_mode"] = pd.DataFrame(by_mode_rows)

        by_task_rows: list[dict] = []
        for (split, representation, model, task), group in predictions_frame.groupby(
            ["split", "representation", "model", "task"], dropna=False
        ):
            result = classification_metrics(group["y_true"], group["y_prob"])
            by_task_rows.append(
                {
                    "split": split,
                    "representation": representation,
                    "model": model,
                    "task": task,
                    **result,
                }
            )
        frames["by_task"] = pd.DataFrame(by_task_rows)

    return frames
