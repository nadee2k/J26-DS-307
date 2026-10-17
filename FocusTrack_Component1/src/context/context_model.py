"""Context-aware behavioural modelling (proposal section 3.7, SO5).

Learning activity is treated as an explicit contextual variable. Two distinct
concerns are kept deliberately separate:

1. ``add_context_features`` produces *model-safe* context features. These are
   derived only from the learning activity, never from the concentration
   reference, so they cannot leak the target.
2. ``context_effect_analysis`` / ``context_state_focus_table`` are descriptive
   analyses of how the *meaning* of states varies across contexts. These do use
   the reference label and are intended for reporting, not as model inputs.
"""

import numpy as np
import pandas as pd

from src.config import CONTEXT_CODES, STATE_COL

LABEL_COL = "focus_reference"


def add_context_code(features: pd.DataFrame, context_col: str = "context") -> pd.DataFrame:
    """Attach the deterministic integer code for the learning activity."""
    out = features.copy()
    if context_col in out.columns:
        out["context_code"] = out[context_col].map(CONTEXT_CODES)
    elif "context_code" not in out.columns:
        out["context_code"] = pd.NA
    return out


def add_context_interaction(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
    n_states: int | None = None,
) -> pd.DataFrame:
    """Add a context x state interaction term used by the context-aware model."""
    out = features.copy()
    if "context_code" not in out.columns or state_col not in out.columns:
        return out
    states = pd.to_numeric(out[state_col], errors="coerce")
    if n_states is None:
        n_states = int(states.max()) + 1 if states.notna().any() else 0
    out["context_state_id"] = out["context_code"].astype("float") * max(n_states, 1) + states
    return out


def add_context_features(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
    n_states: int | None = None,
) -> pd.DataFrame:
    """Model-safe contextual representation (context + context x state)."""
    return add_context_interaction(add_context_code(features), state_col=state_col, n_states=n_states)


def context_state_distribution(features: pd.DataFrame, state_col: str = STATE_COL) -> pd.DataFrame:
    """Share of windows spent in each state per learning context."""
    if features.empty or state_col not in features.columns or "context" not in features.columns:
        return pd.DataFrame()
    counts = features.groupby(["context", state_col], dropna=False).size().unstack(fill_value=0)
    shares = counts.div(counts.sum(axis=1), axis=0)
    return shares.add_prefix("share_state_")


def context_state_focus_table(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
    label_col: str = LABEL_COL,
) -> pd.DataFrame:
    """Mean concentration reference per (context, state) -- descriptive only."""
    if features.empty or label_col not in features.columns:
        return pd.DataFrame()
    frame = features.dropna(subset=[label_col, "context", state_col]).copy()
    if frame.empty:
        return pd.DataFrame()
    frame[label_col] = pd.to_numeric(frame[label_col], errors="coerce")
    return frame.pivot_table(index="context", columns=state_col, values=label_col, aggfunc="mean")


def context_state_agreement(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
    label_col: str = LABEL_COL,
) -> pd.DataFrame:
    """Spearman agreement between contexts' state->focus orderings.

    Low / negative agreement supports the claim that the *meaning* of a state
    depends on the learning context.
    """
    table = context_state_focus_table(features, state_col=state_col, label_col=label_col)
    if table.empty or len(table) < 2:
        return pd.DataFrame()
    return table.T.corr(method="spearman")


def context_effect_analysis(
    features: pd.DataFrame,
    state_col: str = STATE_COL,
    label_col: str = LABEL_COL,
) -> pd.DataFrame:
    """Per-context summary of how states relate to the concentration reference."""
    if features.empty or label_col not in features.columns or "context" not in features.columns:
        return pd.DataFrame()
    frame = features.copy()
    frame[label_col] = pd.to_numeric(frame[label_col], errors="coerce")
    rows = []
    for context, group in frame.groupby("context", dropna=False):
        labels = group.dropna(subset=[label_col])
        row = {
            "context": context,
            "n_windows": int(len(group)),
            "n_labeled_windows": int(len(labels)),
            "mean_focus_reference": float(labels[label_col].mean()) if not labels.empty else np.nan,
            "n_states": int(group[state_col].nunique()) if state_col in group else 0,
        }
        if not labels.empty and state_col in labels.columns:
            per_state = labels.groupby(state_col)[label_col].mean()
            row["state_focus_spread"] = float(per_state.max() - per_state.min())
            row["highest_focus_state"] = int(per_state.idxmax())
            row["lowest_focus_state"] = int(per_state.idxmin())
        mode = group["context"].mode()
        row["dominant_state"] = int(group[state_col].mode().iloc[0]) if state_col in group and not group[state_col].mode().empty else None
        rows.append(row)
    return pd.DataFrame(rows).reset_index(drop=True)
