"""Central configuration for FocusTrack Component 1.

Everything that defines the behavioural representation lives here so that
preprocessing, feature engineering, state discovery, transition modelling,
context modelling and evaluation all agree on column names and constants.
"""

from pathlib import Path
import os

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
FEATURES_DIR = DATA_DIR / "features"
SEQUENCES_DIR = DATA_DIR / "sequences"
RESULTS_DIR = DATA_DIR / "results"
MODELS_DIR = ROOT / "models"

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
# Supabase renamed the anon key to "publishable key"; accept both spellings so a
# .env copied from the dashboard works either way.
SUPABASE_ANON_KEY = (
    os.getenv("SUPABASE_ANON_KEY", "")
    or os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    or os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    or os.getenv("SUPABASE_SECRET_KEY", "")
)

PAGE_SIZE = 1000
RANDOM_STATE = 42

WINDOW_SIZES_SECONDS = (60, 300)
DEFAULT_WINDOW_SECONDS = 60

DEFAULT_N_STATES = 4
DEFAULT_STATE_METHOD = "kmeans"

TABLES = (
    "students",
    "study_sessions",
    "behavior_logs",
    "concentration_logs",
)

STUDENT_EXPORT_COLUMNS = (
    "id",
    "age",
    "gender",
    "learning_type",
    "created_at",
)

CONCENTRATION_LABELS = {
    1: "Fully Distracted",
    2: "Somewhat Distracted",
    3: "Neutral",
    4: "Engaged",
    5: "Deep Focus",
}

TASK_TYPES = ("reading", "coding", "writing", "zoom", "assignment")

# Learning context is treated as an explicit categorical variable. The codes are
# deterministic so that models and saved artifacts are reproducible.
CONTEXT_CODES = {name: index for index, name in enumerate(TASK_TYPES)}
CONTEXT_CODE_NAMES = {code: name for name, code in CONTEXT_CODES.items()}

# ---------------------------------------------------------------------------
# Window-level feature columns produced by src.features.feature_builder
# ---------------------------------------------------------------------------

# Conventional aggregated interaction features. These form the baseline
# representation (proposal section 3.9).
AGGREGATED_FEATURE_COLS = [
    "key_event_count",
    "typing_rate",
    "mouse_distance",
    "mouse_clicks",
    "idle_ratio",
    "application_switch_count",
    "unique_application_count",
]

# Additional temporal features beyond simple aggregation.
TEMPORAL_FEATURE_COLS = [
    "window_index",
    "session_progress",
    "mean_keyboard_count",
    "std_keyboard_count",
    "max_keyboard_count",
    "burst_count",
    "mean_burst_duration",
    "mean_burst_length",
    "mean_mouse_velocity",
    "std_mouse_velocity",
    "mean_mouse_acceleration",
    "mean_idle_time",
    "application_switch_frequency",
]

# Window columns used for sequence construction and sequential modelling.
STATE_COL = "interaction_state"

STATE_FEATURE_COLS = [
    STATE_COL,
]

TRANSITION_FEATURE_COLS = [
    "previous_state",
    "transition_type",
    "state_duration",
    "state_change_rate",
    "state_entropy",
    "stable_state_duration",
    "interruption_count",
    "recovery_count",
]

CONTEXT_FEATURE_COLS = [
    "context_code",
]

# Identifiers / bookkeeping columns that must never be used as model features.
NON_FEATURE_COLS = [
    "participant_id",
    "session_id",
    "context",
    "context_code",
    "window_start",
    "window_end",
    "window_size_seconds",
    "window_index",
    "application_sequence",
    "focus_reference",
    "focus_label",
    "concentration_label",
]

# ---------------------------------------------------------------------------
# Session-level representation used for concentration classification
# ---------------------------------------------------------------------------

# Numeric window features aggregated (mean/std) to one row per session for the
# baseline representation.
BASELINE_SESSION_COLS = [
    "typing_rate",
    "mouse_distance",
    "mouse_clicks",
    "click_count",
    "idle_ratio",
    "application_switch_count",
    "application_switch_frequency",
    "key_event_count",
    "mouse_event_count",
    "unique_application_count",
    "session_progress",
]

# Extra temporal-window features that only the proposed representation uses.
TEMPORAL_SESSION_COLS = [
    "mean_keyboard_count",
    "std_keyboard_count",
    "max_keyboard_count",
    "burst_count",
    "mean_burst_duration",
    "mean_burst_length",
    "mean_mouse_velocity",
    "std_mouse_velocity",
    "mean_mouse_acceleration",
    "mean_idle_time",
    "typing_duration",
]

# Transition features aggregated to session level.
TRANSITION_SESSION_COLS = [
    "state_change_rate",
    "state_entropy",
    "interruption_count",
    "recovery_count",
    "stable_state_duration",
    "state_duration",
]

FEATURE_GROUP_ORDER = ("baseline", "temporal", "state", "transition", "context")


def ensure_data_dirs() -> None:
    for path in (
        RAW_DIR,
        PROCESSED_DIR,
        FEATURES_DIR,
        SEQUENCES_DIR,
        RESULTS_DIR,
        MODELS_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
