"""Infer a participant's learning type (screen vs non-screen) from behaviour.

The recorded ``learning_type`` column in the ``students`` table is metadata that
may be missing — or, as observed in this dataset, assigned independently of the
actual behaviour. This module therefore decides **unsupervised**: participants
are described by their mean behavioural activity, standardised and clustered
into exactly two groups (KMeans), and the more active group is labelled
``screen`` (screen-based learning produces keyboard/mouse/application activity,
non-screen learning mostly produces idle windows).

The decision is made **per participant** (aggregated across all their sessions)
and the projection of each participant onto the axis joining the two cluster
centroids is exposed as a ``screen_score`` in ``[0, 1]`` so callers can show how
decided each participant is, not just the binary answer.

When recorded labels are available they are only used afterwards, for an
*agreement* figure — never to fit or orient the clusters.
"""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.preprocessing import StandardScaler

from src.config import RANDOM_STATE

# Behavioural activity features reported per group. ``idle_ratio`` is
# deliberately excluded: it is constant (0) in the current artifacts.
BEHAVIOUR_FEATURES = [
    "typing_rate",
    "key_event_count",
    "mouse_distance",
    "mouse_clicks",
    "application_switch_count",
    "unique_application_count",
]

# Clustering and orientation use *input volume* only: whether the participant
# actually interacts with the computer. Application-switching/app-variety
# features describe which application pattern dominates, not whether learning
# happens on the screen, and letting them orient the label once produced the
# counter-intuitive result of a low-typing group being called "screen".
ACTIVITY_FEATURES = ["typing_rate", "key_event_count", "mouse_distance", "mouse_clicks"]

GROUP_LABELS = ("screen", "non-screen")


def _round(value: Any, digits: int = 4) -> Any:
    """JSON-safe rounding that tolerates numpy/pandas scalars."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return value
    if not np.isfinite(number):
        return None
    return round(number, digits)


def participant_profile(features: pd.DataFrame) -> pd.DataFrame:
    """One row per participant: mean behaviour + activity counts."""
    if features.empty or "participant_id" not in features.columns:
        return pd.DataFrame()

    work = features.copy()
    out = work.groupby("participant_id", dropna=True)

    rows: list[dict[str, Any]] = []
    for participant_id, group in out:
        row: dict[str, Any] = {"participant_id": str(participant_id)}
        for col in BEHAVIOUR_FEATURES:
            if col in group.columns:
                row[col] = _round(pd.to_numeric(group[col], errors="coerce").mean())
        row["n_windows"] = int(len(group))
        if "session_id" in group.columns:
            row["n_sessions"] = int(group["session_id"].nunique())
        else:
            row["n_sessions"] = 1

        active = pd.Series(False, index=group.index)
        for col in ("key_event_count", "mouse_clicks", "mouse_event_count", "typing_rate"):
            if col in group.columns:
                active |= pd.to_numeric(group[col], errors="coerce").fillna(0) > 0
        row["active_window_share"] = _round(float(active.mean())) if len(group) else 0.0
        rows.append(row)

    profile = pd.DataFrame(rows)
    if profile.empty:
        return profile
    # Only keep behaviour columns that survived aggregation.
    keep = ["participant_id"] + [
        c for c in profile.columns if c in BEHAVIOUR_FEATURES and profile[c].notna().any()
    ] + ["n_windows", "n_sessions", "active_window_share"]
    return profile.loc[:, keep]


def classify_learning_type(
    features: pd.DataFrame,
    recorded: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Cluster participants into screen / non-screen and describe the result.

    Parameters
    ----------
    features:
        Window-level feature table with (at least) ``participant_id`` and
        behavioural activity columns.
    recorded:
        Optional ``participant_id -> learning_type`` mapping from the students
        table, used only to report how often the inferred decision agrees with
        the recorded label.
    """
    profile = participant_profile(features)
    meta: dict[str, Any] = {
        "method": "KMeans (k=2) on z-scored participant mean input activity",
        "orientation": "cluster with the higher mean keyboard/mouse input volume = 'screen'",
        "level": "participant",
        "random_state": RANDOM_STATE,
        "screen_score": "projection of each participant onto the centroid axis, clipped to [0, 1]",
    }

    def fail(reason: str) -> dict[str, Any]:
        return {"ok": False, "reason": reason, "meta": meta, "participants": [], "groups": []}

    if profile.empty:
        return fail("No feature table with participant_id found for this source. Run the pipeline first.")
    if len(profile) < 2:
        return fail("At least two participants are needed to decide a behavioural learning type.")

    report_cols = [c for c in BEHAVIOUR_FEATURES if c in profile.columns]
    cluster_cols = [c for c in ACTIVITY_FEATURES if c in profile.columns] or report_cols
    if not cluster_cols:
        return fail("No behavioural activity columns (typing/mouse/app) available in the features table.")

    X = profile[cluster_cols].fillna(0.0).to_numpy(dtype=float)
    if len(np.unique(X, axis=0)) < 2:
        return fail("All participants have identical behaviour — nothing to separate them on.")

    scaled = StandardScaler().fit_transform(X)
    model = KMeans(n_clusters=2, random_state=RANDOM_STATE, n_init=10)
    cluster = model.fit_predict(scaled)

    # Orient: the cluster with the higher mean input activity is "screen".
    composite = scaled.mean(axis=1)
    clusters = [int(k) for k in np.unique(cluster)]
    means = {k: float(composite[cluster == k].mean()) for k in clusters}
    if len({round(m, 12) for m in means.values()}) == 1 and len(clusters) == 2:
        # Exact tie (e.g. two participants symmetric on every z-score): fall
        # back to raw input volume so orientation stays well-defined.
        raw = {k: float(X[cluster == k].sum()) for k in clusters}
        screen_cluster = max(raw, key=raw.get)
    else:
        screen_cluster = max(means, key=means.get)
    other_cluster = next(k for k in clusters if k != screen_cluster)

    axis = model.cluster_centers_[screen_cluster] - model.cluster_centers_[other_cluster]
    denom = float(np.dot(axis, axis))
    projected = (
        (scaled - model.cluster_centers_[other_cluster]) @ axis / denom if denom > 0 else np.zeros(len(scaled))
    )
    scores = np.clip(projected, 0.0, 1.0)

    profile = profile.copy()
    profile["inferred_learning_type"] = [
        GROUP_LABELS[0] if int(c) == screen_cluster else GROUP_LABELS[1] for c in cluster
    ]
    profile["screen_score"] = [_round(s) for s in scores]
    profile = profile.sort_values("screen_score", ascending=False).reset_index(drop=True)

    meta["features_used"] = cluster_cols
    meta["features_reported"] = report_cols
    meta["n_participants"] = int(len(profile))
    try:
        meta["silhouette"] = _round(silhouette_score(scaled, cluster))
    except Exception:  # noqa: BLE001 - silhouette is optional decoration
        meta["silhouette"] = None

    groups: list[dict[str, Any]] = []
    for label in GROUP_LABELS:
        part = profile[profile["inferred_learning_type"] == label]
        groups.append(
            {
                "learning_type": label,
                "participants": int(len(part)),
                "metrics": {c: _round(part[c].mean()) for c in report_cols}
                | {
                    "n_windows": int(part["n_windows"].sum()),
                    "active_window_share": _round(part["active_window_share"].mean())
                    if "active_window_share" in part
                    else None,
                    "mean_screen_score": _round(part["screen_score"].mean()),
                },
            }
        )

    agreement: dict[str, Any] | None = None
    if recorded:
        pairs = [
            (str(row["inferred_learning_type"]), str(recording).strip().lower())
            for _, row in profile.iterrows()
            if (recording := recorded.get(str(row["participant_id"]))) is not None
        ]
        if pairs:
            hits = sum(1 for inferred, expected in pairs if inferred == expected)
            agreement = {
                "n_labelled": len(pairs),
                "agreement_rate": _round(hits / len(pairs)),
                "note": "Recorded labels are not used to fit or orient the clusters; this is a post-hoc comparison only.",
            }
    meta["recorded_agreement"] = agreement

    participant_cols = [
        "participant_id",
        "inferred_learning_type",
        "screen_score",
        *report_cols,
        "active_window_share",
        "n_windows",
        "n_sessions",
    ]
    participants = [
        {k: (_round(v) if isinstance(v, (float, np.floating)) else v) for k, v in row.items()}
        for row in profile.loc[:, participant_cols].to_dict(orient="records")
    ]
    return {"ok": True, "meta": meta, "participants": participants, "groups": groups}
