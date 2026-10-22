"""Interaction-state discovery (proposal SO3)."""

from focustrack.states.hmm import HMMStateModel, n_parameters
from focustrack.states.profile import (
    interruption_states,
    label_states,
    state_sequence,
    transition_matrix,
)
from focustrack.states.select import (
    best_fit_row,
    best_n_states,
    seed_stability,
    select_n_states,
    selection_summary,
)

__all__ = [
    "HMMStateModel",
    "n_parameters",
    "select_n_states",
    "best_n_states",
    "selection_summary",
    "best_fit_row",
    "seed_stability",
    "label_states",
    "interruption_states",
    "transition_matrix",
    "state_sequence",
]
