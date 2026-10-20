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

The **Try session demo** link opens `/session-demo`, a standalone start/end
workflow for demonstrating Component 1 outcomes. It records only keyboard
counts, pointer distance/click counts, idle time, and whether this browser tab
is visible; it does not record key contents or monitor activity in other
applications. Ending a session sends those snapshots to the existing live
inference endpoint and displays trained interaction-state, transition, and HMM
outputs. Snapshots and readouts remain in server memory only and expire after
12 hours. The page also offers a clearly labelled generated sample session for
a quick demonstration without waiting for a live capture. A trained state
model is required for either workflow.

Tabs:

| Tab | Shows | Proposal link |
|---|---|---|
| Overview & run | data counts, last-run parameters, cluster quality, a run form + live log — plus an **analysis-type selector**: interaction states (default) or the behaviour-inferred learning type | — |
| States & transitions | state distribution, per-state profiles, session timelines, transition matrices (incl. per-context), interruptions/recoveries | SO4 |
| Context modelling | context distribution, state composition per context, context-effect analysis, model-safe vs descriptive features | SO5 |
| Evaluation & statistics | baseline/proposed/ablation, HMM augmentation, KMeans vs HMM states, paired statistics with bootstrap CIs, LOPO variation | SO6 |
| Integration output | schema validation status, declared fields, the session and window behavioural outputs | M10 |
| Session Analyzer | upload **one session's** events and get the Component 1 output immediately: timeline, state shares, transitions, integration rows + CSV downloads | M10 |
| Focus dashboard | a **standalone page** (`/focus`, linked from the tab bar) with trends across all past sessions: stability, state composition, interruptions, concentration correlation, timelines and a per-session table | SO4 |

Runs execute in a background thread (`POST /api/run`, polled via
`GET /api/status`), one at a time, and refresh the artefacts for the selected
source when they finish.

### Session Analyzer (single-session inference)

The Session Analyzer does not re-run the pipeline: it reuses every stage of
`src/pipeline.py` on one uploaded events file and applies the trained
`state_model.joblib` / `state_scaler.joblib` of the chosen source, so a state
keeps the meaning it has in the dashboard (`ui/session_infer.py`).

| Endpoint | Purpose |
|---|---|
| `GET /api/session/analyze/ready?source=` | are the trained state artefacts available? |
| `POST /api/session/analyze` | multipart upload (`file` + optional `participant_id`, `session_id`, `context`, `context_code`, `source`, `window_seconds`) → full analysis JSON |
| `GET /api/session/sample?source=` | minimal events CSV showing the expected columns |
| `GET /api/session/download/{session\|window}?key=` | the generated `behavioural_output_*.csv` rows (valid for 1 h) |

The upload is a `behavior_logs`-shaped CSV (`created_at`/`timestamp`,
`session_id`, the keyboard/mouse/idle/application columns); the sibling
`study_sessions` / `students` context is derived from the form fields.

### Live student dashboard (in-session inference)

While a study session runs, the student app polls the live endpoints: it pushes
the behaviour snapshots it is already capturing to a per-session in-memory
buffer, and each push re-runs the single-session analyzer over the accumulated
buffer plus the trained HMM (`ui/live.py`). The response is intentionally
student-facing — one current interaction state with a plain-language descriptor
(from `state_profiles.csv`), state shares, the HMM regime and its confidence, a
short timeline and a one-paragraph summary — so the learner sees *outcomes* of
the trained models rather than the researcher-level detail. Nothing is written
to the database; the `behavior_logs` rows remain the record, and buffers expire
after 12 h of inactivity.

| Endpoint | Purpose |
|---|---|
| `GET /api/live/ready?source=` | state-model readiness plus HMM availability for the source |
| `POST /api/live/push` | JSON `{source, participant_id, session_id, context, context_code?, window_seconds?, snapshots:[…]}` → current student readout |
| `GET /api/live/state?session_id=` | the last readout for a session, without pushing |
| `DELETE /api/live/session?session_id=` | drop a session's buffer (called when the session ends) |

CORS is open to the local student app (`http://localhost:3000|3001` and the
`127.0.0.1` equivalents), and the window length defaults to the one the state
model was fitted on so a state keeps its meaning. The dashboard lives at
`/insights` in `Student_DataCollection_UI/frontend` and is configured with
`NEXT_PUBLIC_INSIGHTS_API_URL` / `NEXT_PUBLIC_INSIGHTS_SOURCE`.

### Focus dashboard (trends across past sessions)

`/focus` is a separate page (not a tab of the analysis app) that answers the
learner-facing question *“how has my focus been over time?”* from the trained
models’ per-session output. It is deliberately built only from Component 1 data
— the behaviour-derived interaction states, their transitions and the HMM
regime, plus the learner’s own concentration ratings — with no environment,
telemetry or vision input.

The page is fed by `GET /api/focus?source=`, which re-aggregates the existing
pipeline artefacts server-side (`ui/focus.py`, in pandas — nothing is inferred
on the fly) into one chronological row per session: dominant state and its
share, state composition, run length / stability, interruptions and recoveries,
state entropy, HMM regime and dwell, and the self-reported concentration when a
session has one. It reuses `ui/live.state_descriptors()` so a state keeps the
same plain-language meaning as in the live readout.

| Endpoint | Purpose |
|---|---|
| `GET /focus` | the standalone focus-trends page |
| `GET /api/focus?source=` | the aggregated cross-session payload the page renders |

The view degrades gracefully with tiny or missing data (single-window sessions,
no concentration ratings, no state profiles), listing what is unavailable in a
notes strip rather than failing.

### Learning type (screen vs non-screen, behaviour-inferred)

The Overview tab's **Analysis type** selector can decide each participant's
learning type from behaviour alone (`src/analysis/learning_type.py`): windows
are averaged per participant, z-scored on keyboard/mouse **input volume**
(`typing_rate`, `key_event_count`, `mouse_distance`, `mouse_clicks`) and
clustered into exactly two groups (KMeans, k=2), with the higher-activity group
labelled `screen`. Every participant also gets a `screen_score` in `[0, 1]` —
the projection onto the axis joining the two cluster centroids — so borderline
cases are visible rather than hidden behind the binary answer.

Recorded `learning_type` labels from the `students` table are **never** used to
fit or orient the clusters; they are only compared afterwards and the agreement
rate is reported as a sanity check (in the synthetic source the recorded label
is assigned randomly, so agreement ≈ chance there is expected).

| Endpoint | Purpose |
|---|---|
| `GET /api/analysis/learning-type?source=` | per-participant decision, group comparison, method metadata, recorded-label agreement |

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
node scripts/ui_smoke.js ui/static/app.js ui/static/session.js
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
