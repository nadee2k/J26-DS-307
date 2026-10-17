# FocusTrack — Component 1

**Context-Aware Learner Interaction State Modeling for Concentration Assessment**

Individual component of the FocusTrack project (J26-DS-307). This component builds
the behavioural-intelligence layer: it turns timestamped keyboard, mouse and
application metadata into temporal interaction states and transitions, conditions
their interpretation on the learner's activity, and evaluates whether that
representation adds information beyond conventional aggregated features.

## Research framing

```
Learning context
      -> behavioural events (keyboard / mouse / application metadata)
      -> temporal windows + features
      -> interaction states            (unsupervised discovery)
      -> state transitions             (duration, persistence, interruption, recovery)
      -> context-aware representation
      -> concentration prediction
         |- baseline   : aggregated features
         |- proposed   : temporal + states + transitions + context
         |- ablation   : proposed minus one representation group
```

The target is **Macro-F1**, with participant-level and cross-context validation
and an ablation analysis (proposal sections 3.9–3.11).

## Layout

| Path | Purpose |
|---|---|
| `src/config.py` | Column names, context codes, feature groups, paths |
| `src/database/` | Supabase client + raw-table export/load |
| `src/preprocessing/` | Cleaning, synchronisation, session segmentation, windowing, sequence construction |
| `src/features/` | Keyboard, mouse, application, temporal features and the window feature builder |
| `src/states/` | Interaction-state discovery (KMeans / GMM), profiling, validation |
| `src/transitions/` | Transition features, run-length view, transition matrices (SO4) |
| `src/context/` | Context codes, context features and context-effect analysis (SO5) |
| `src/models/` | Candidate models and the session-level dataset builder |
| `src/evaluation/` | Splits, metrics, ablation and the experiment runner (SO6) |
| `src/pipeline.py` | End-to-end orchestration |
| `src/simulation.py` | Synthetic data so the pipeline runs before real data exists |
| `src/visualization/` | Reusable plotting helpers |
| `scripts/run_pipeline.py` | CLI entry point |
| `notebooks/` | Exploratory analysis |
| `tests/` | Unit + smoke tests (`pytest`) |

## Setup

```bash
cd FocusTrack_Component1
pip install -r requirements.txt
cp .env.example .env        # only needed for the Supabase source
```

## Running

```bash
# 1. From a raw CSV export in data/raw/
python scripts/run_pipeline.py --source csv --window 60 --states 4

# 2. Pull fresh tables from Supabase, export, then run
python scripts/run_pipeline.py --source supabase

# 3. Generate synthetic data and run (before real data exists)
python scripts/run_pipeline.py --source synthetic --window 60 --states 4
```

Artifacts are written to:

- `data/processed/events.csv`
- `data/features/features.csv`, `state_profiles.csv`, `session_dataset.csv`
- `data/sequences/state_sequences.csv`, `window_sequences.csv`
- `data/results/…` (transition matrices, context analysis, experiment results)
- `models/state_model.joblib`, `models/state_scaler.joblib`

Then open `notebooks/01_exploratory_analysis.ipynb`.

## Data schema

Raw tables mirror the collection UI / Supabase schema (`Student_DataCollection_UI/supabase/schema.sql`):

| Table | Key fields |
|---|---|
| `students` | participant id, age, gender, learning_type |
| `study_sessions` | session id, student id, `task_type` (= learning context), timestamps |
| `behavior_logs` | ~1 s snapshots: `keyboard_count`, `mouse_distance`, `mouse_clicks`, `idle_time`, `active_application` |
| `concentration_logs` | self-reported `level` 1–5 with `recorded_at` |

The learning activity selected before the session (`task_type`) is the contextual variable.

### Privacy

Only behavioural **metadata** is used. No raw key characters, passwords, message
contents or clipboard contents are stored or processed. Participants are
pseudonymised, and the raw logs are never sent to external servers.

## Tests

```bash
pytest -q
```

## Notes and current status

- The pipeline is complete and runs end-to-end on synthetic data; the
  baseline / proposed / ablation comparison produces a results table.
- The discovered states are data-driven and are intentionally **not** named
  "focused" / "distracted". Interruption and recovery are defined structurally
  (a state change; an `A -> B -> A` return).
- Context-effect analysis uses the reference label and is descriptive only. The
  model-safe context features (`context_code`, `context × state`) never use the
  label, so there is no target leakage.
- Sequential modelling (e.g. HMM) can build on `data/sequences/`; the sequence
  artifacts are produced but no sequential model is implemented yet.
- Real data collection follows the FocusTrack protocol; `src/simulation.py`
  is a testing aid, not a substitute for participant data.
