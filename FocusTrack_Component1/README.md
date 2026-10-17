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
| `src/models/` | Candidate models, the session-level dataset builder, and the discrete HMM |
| `src/evaluation/` | Splits, metrics, ablation, sequential (HMM) + state-representation experiments, statistics (SO6) |
| `src/integration/` | Behavioural output contract for multimodal fusion (window + session schemas, validation) |
| `src/pipeline.py` | End-to-end orchestration |
| `src/simulation.py` | Synthetic data so the pipeline runs before real data exists |
| `src/visualization/` | Reusable plotting helpers |
| `scripts/run_pipeline.py` | CLI entry point |
| `ui/` | Demo UI: FastAPI API + static HTML/JS frontend |
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
- `data/results/…` (transition matrices, context analysis, HMM analysis, experiment and statistical results)
- `data/results/integration/behavioural_output_window.csv`,
  `data/results/integration/behavioural_output_session.csv`,
  `data/results/integration_validation.json`, `data/results/run_manifest.json`
- `data/synthetic/…` — the same layout for the synthetic demo source (UI only)
- `models/state_model.joblib`, `state_scaler.joblib`, `hmm_model.joblib`

Then open `notebooks/01_exploratory_analysis.ipynb`.

## Demo UI

```bash
python -m ui.app --port 8000     # then open http://localhost:8000
```

A FastAPI server plus a static HTML/JS frontend that reads the pipeline
artefacts live. Two views of the data can be switched in the header:

- **Real pilot data** — the Supabase tables, written to the default `data/` layout;
- **Synthetic demo data** — generated on demand into `data/synthetic/`, so the
  full analysis can be demonstrated before pilot collection finishes
  (banner-labelled as demonstration-only).

Tabs:

| Tab | Shows | Proposal link |
|---|---|---|
| Overview & run | data counts, last-run parameters, cluster quality, a run form + live log | — |
| States & transitions | state distribution, per-state profiles, session timelines, transition matrices (incl. per-context), interruptions/recoveries | SO4 |
| Context modelling | context distribution, state composition per context, context-effect analysis, model-safe vs descriptive features | SO5 |
| Evaluation & statistics | baseline/proposed/ablation, HMM augmentation, KMeans vs HMM states, paired statistics with bootstrap CIs, LOPO variation | SO6 |
| Integration output | schema validation status, declared fields, the session and window behavioural outputs | M10 |

Runs execute in a background thread (`POST /api/run`, polled via
`GET /api/status`), one at a time, and refresh the artefacts for the selected
source when they finish.

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

# optional: headless check that every demo-UI view renders against a running server
python -m ui.app --port 8000 &
node scripts/ui_smoke.js ui/static/app.js
```

## Notes and current status

- The pipeline is complete and runs end-to-end on synthetic data; the
  baseline / proposed / ablation comparison produces a results table.
- **Sequential modelling:** a self-contained categorical Hidden Markov Model
  (`src/models/sequential.py`, NumPy/SciPy Baum-Welch + Viterbi, no extra
  dependency) is fitted to the interaction-state sequences. `--hidden N` sets
  the number of hidden regimes. In the sequential experiment the HMM is refitted
  *inside each fold on training sessions only*, so no information leaks across
  the split; the resulting features test whether sequence structure adds value
  beyond the state/transition features.
- **Statistical analysis** (`src/evaluation/statistics.py`): paired
  fold-level comparisons against the baseline with bootstrap confidence
  intervals, Wilcoxon / paired t-test p-values, Cohen's d_z and Cliff's delta,
  plus between-participant and between-context variation from leave-one-
  participant-out predictions.
- **State representation comparison**
  (`evaluate_hmm_state_representation` in
  `src/evaluation/sequential_experiments.py`): the same models are trained once
  with the KMeans interaction states and once with HMM-decoded hidden regimes,
  where the HMM is fitted per fold on training sessions only and the state,
  transition and context features are rebuilt from the decoded regimes.
  Results land in `state_representation_experiments.csv`.
- **Integration contract** (`src/integration/export.py`): the two artefacts other
  FocusTrack components consume — a window-level behavioural stream and a
  session-level summary (dominant state, state shares, transition,
  interruption/recovery measures, the concentration-related prediction and a
  plain-language summary). The schemas are versioned
  (`INTEGRATION_SCHEMA_VERSION`) and validated at the end of every run; a
  `missing columns` violation is printed as
  `Integration output schema validation: …`.
- The discovered states are data-driven and are intentionally **not** named
  "focused" / "distracted". Interruption and recovery are defined structurally
  (a state change; an `A -> B -> A` return).
- Context-effect analysis uses the reference label and is descriptive only. The
  model-safe context features (`context_code`, `context × state`) never use the
  label, so there is no target leakage.
- Real data collection follows the FocusTrack protocol; `src/simulation.py`
  is a testing aid, not a substitute for participant data.
- Runtime: the HMM augmentation, the state-representation comparison and the
  leave-one-participant-out analysis are the slowest stages. Use `--no-hmm` to
  skip the HMM-based experiments, or `--no-ml` to run only the descriptive
  pipeline.
