import pandas as pd
from sklearn.metrics import calinski_harabasz_score, davies_bouldin_score, silhouette_score

from src.states.state_discovery import prepare_state_matrix


def cluster_quality(features: pd.DataFrame, label_col: str = "interaction_state") -> dict:
    if features.empty or label_col not in features.columns:
        return {"silhouette": None, "davies_bouldin": None, "calinski_harabasz": None}
    labels = features[label_col]
    if labels.nunique() < 2:
        return {"silhouette": None, "davies_bouldin": None, "calinski_harabasz": None}
    X_scaled, _, _ = prepare_state_matrix(features)
    return {
        "silhouette": float(silhouette_score(X_scaled, labels)),
        "davies_bouldin": float(davies_bouldin_score(X_scaled, labels)),
        "calinski_harabasz": float(calinski_harabasz_score(X_scaled, labels)),
    }


def state_stability(features: pd.DataFrame) -> pd.DataFrame:
    if features.empty or "interaction_state" not in features.columns:
        return pd.DataFrame()
    by_participant = (
        features.groupby(["participant_id", "interaction_state"]).size().unstack(fill_value=0)
    )
    return by_participant.div(by_participant.sum(axis=1), axis=0)
