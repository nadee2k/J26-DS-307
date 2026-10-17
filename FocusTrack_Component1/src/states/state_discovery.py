import pandas as pd
from sklearn.cluster import KMeans
from sklearn.mixture import GaussianMixture
from sklearn.preprocessing import StandardScaler

from src.config import RANDOM_STATE

DEFAULT_STATE_FEATURES = [
    "typing_rate",
    "mean_keyboard_count",
    "std_keyboard_count",
    "burst_count",
    "mean_mouse_velocity",
    "mouse_clicks",
    "idle_ratio",
    "application_switch_frequency",
    "unique_application_count",
]


def prepare_state_matrix(features: pd.DataFrame, columns: list[str] | None = None):
    cols = [c for c in (columns or DEFAULT_STATE_FEATURES) if c in features.columns]
    X = features[cols].fillna(0.0)
    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)
    return X_scaled, cols, scaler


def discover_states(
    features: pd.DataFrame,
    n_states: int = 4,
    method: str = "kmeans",
    columns: list[str] | None = None,
) -> tuple[pd.DataFrame, object, StandardScaler, list[str]]:
    out = features.copy()
    if out.empty:
        out["interaction_state"] = pd.Series(dtype=int)
        return out, None, None, columns or DEFAULT_STATE_FEATURES

    X_scaled, cols, scaler = prepare_state_matrix(out, columns)
    n_states = max(2, min(n_states, max(2, len(out))))
    if method == "gmm":
        model = GaussianMixture(n_components=n_states, random_state=RANDOM_STATE)
        labels = model.fit_predict(X_scaled)
    else:
        model = KMeans(n_clusters=n_states, random_state=RANDOM_STATE, n_init=10)
        labels = model.fit_predict(X_scaled)
    out["interaction_state"] = labels
    return out, model, scaler, cols
