# FocusTrack — Demo Summary (J26-DS-307)

**Title:** FocusTrack: Multimodal Concentration Detection for Screen and Non-Screen Learners
**Component shown:** Component 1 — *Context-Aware Learner Interaction State Modeling for Concentration Assessment*

---

## 1. Elevator pitch (30 seconds)

FocusTrack estimates a learner's concentration from passive behavioural signals —
keystrokes, mouse activity, active application, plus environment and vision data from
an ESP32 sensor node. Component 1 turns those raw events into 60-second behavioural
windows, discovers **unsupervised interaction states**, and predicts concentration
level using a **context-aware representation**. We show it beats a conventional
baseline of raw aggregated features, validated with participant-level cross-validation,
cross-context holdout, ablation studies, and statistical tests.

---

## 2. The story arc for the demo (5–7 minutes)

### Step 1 — Data collection (1 min)
- **Hardware:** ESP32 sensor node → temperature, humidity, light, noise, motion
  (`Student_DataCollection_UI/hardware/`).
- **Browser:** 1 Hz snapshot of keyboard count, mouse distance, clicks, idle time,
  active application (`frontend/hooks/use-behavior.tsx`).
- **Vision:** face detected, eye gaze, head direction, phone detected.
- **Label:** self-reported concentration level **1–5** per session
  (`concentration_logs`), mapped to labels: 1 Fully Distracted → 5 Deep Focus.
- **Storage:** Supabase (Postgres), 7-table schema at
  `Student_DataCollection_UI/supabase/schema.sql`.

### Step 2 — Pipeline (1 min)
```
raw events → cleaning/sync → 60 s sliding windows → features
→ KMeans interaction states (k=4) → transition features → context encoding
→ session-level dataset → models → evaluation → JSON/CSV export
```
Entry point: `python scripts/run_pipeline.py --source {supabase|csv|synthetic}`

### Step 3 — Feature engineering (1 min)
Five feature groups (defined in `src/config.py`, built by `src/features/`):
1. **Baseline/aggregated** — typing rate, mouse distance/clicks, idle ratio,
   application switches, unique apps.
2. **Temporal** — burst count/duration, keyboard mean/std/max, mouse velocity and
   acceleration, session progress, window-over-window deltas.
3. **State** — discrete `interaction_state` id from unsupervised clustering.
4. **Transition** — previous state, state change rate, state entropy, stable-state
   duration, interruption count, recovery count.
5. **Context** — task type (reading/coding/writing/zoom/assignment), location,
   learning type (screen vs non-screen).

### Step 4 — Models (1 min)
- **Unsupervised:** KMeans (k=4) or GMM for interaction states; profiled into
  interpretable Low/Medium/High states (`state_profiles.csv`).
- **Sequential:** discrete HMM (3 hidden states), Baum-Welch EM with 3 random
  restarts, Viterbi decoding (`src/models/sequential.py`).
- **Supervised:** Random Forest (300 trees), SVM (RBF, C=1, scaled), XGBoost
  (300 trees, depth 4, lr 0.1) — `src/models/train.py`.
- **Label rule:** session mean of 1–5 self-report → `floor(mean + 0.5)`; binary
  positive class ≥ 3.5. **States are never fitted on labels** (no leakage).

### Step 5 — Evaluation (1.5 min)
- **Primary metric:** Macro-F1 (balanced across classes); secondary: balanced
  accuracy, accuracy, ROC-AUC.
- **5-fold StratifiedGroupKFold**, groups = participant/session → no same-participant
  leakage between folds.
- **Cross-context holdout:** train on seen tasks/locations, test on unseen ones.
- **Ablation:** baseline vs proposed vs proposed-minus-one-group (no_temporal,
  no_context, no_transition, no_state).
- **Statistics:** Wilcoxon signed-rank, paired t-test, Cohen's dz, Cliff's delta,
  bootstrap CI (`src/evaluation/statistics.py`).

### Step 6 — Demo UI (2 min)
FastAPI app at `FocusTrack_Component1/ui/`:
- **Source toggle (real ↔ synthetic)** — real = Supabase pilot; synthetic clearly
  banner-labelled *demo only*.
- **Overview / Summary** — run manifest, cluster quality, experiment tables.
- **Session Demo** — per-session timeline, states, transitions, outcome
  (e.g. *Engaged* / *Neutral*).
- **Focus / Labelling** — shows the labelling rule via `GET /api/labelling/rules`.
- **Live** — streaming view.
- `GET /health` for liveness.

---

## 3. Headline numbers to quote

**Run scale**
| Source | Events | Windows | Sessions | States |
|---|---|---|---|---|
| Real pilot | 2,636 | 94 | 2 | 4 (KMeans) |
| Synthetic demo | 27,000 | 450 | 45 | 4 (KMeans) |

**Cluster quality (real):** silhouette **0.773**, Davies-Bouldin **0.676**,
Calinski-Harabasz **142.6** → states are well separated.

**Classification — Macro-F1, participant split:**

| Representation | Model | Real | Synthetic |
|---|---|---|---|
| Baseline | RF | 0.442 | 0.464 |
| **Proposed** | SVM | **0.534** | **0.589** |
| Proposed | RF | 0.443 | 0.511 |
| Ablation no-transition | SVM | — | 0.623 |

**Cross-context (harder, unseen tasks):** synthetic proposed+SVM **0.377** vs
baseline+SVM **0.083** — the context-aware representation is far more robust to
context shift.

**Statistics (synthetic, SVM, proposed vs baseline):** mean Δ Macro-F1 **+0.216**,
95% CI [0.080, 0.352], Cohen's dz **1.24**, Cliff's δ 0.80, p(t-test) 0.050.
Best contrast: no-transition+SVM, Δ +0.249, dz 1.87, **p = 0.014**.

**Real data (small pilot):** SVM proposed vs baseline Δ **+0.124** (dz 0.89);
RF Δ +0.001 — honest note: n=2 sessions is too small for significance.

---

## 4. Honest limitations (say these before the examiner does)

1. **Real pilot is tiny** (2 sessions, 94 windows) — real numbers are indicative,
   not conclusive; synthetic data (45 sessions) drives the demo.
2. **HMM adds little on synthetic data** (proposed 0.589 vs proposed_hmm 0.543 SVM)
   — interaction-state features already capture most sequential information.
3. **Labels are self-reported** (1–5), noisy by nature; states are unsupervised and
   label-free, but the target inherits self-report bias.
4. **XGBoost errors** on some real sequential runs (`base_score must be in (0,1)`
   with tiny data) — known issue, mitigated by the synthetic source.
5. Cross-context Macro-F1 is much lower than participant-level — generalisation to
   unseen tasks remains the open research problem (future work: more participants).

---

## 5. Demo runbook (commands)

```bash
cd FocusTrack_Component1
pip install -r requirements.txt

# re-run pipeline (optional — results already committed)
python scripts/run_pipeline.py --source synthetic --window 60 --states 4

# start demo UI
uvicorn ui.app:app --port 8000   # then open http://localhost:8000
```

Tests: `pytest` (100+ tests across features, states, models, evaluation, UI).

---

## 6. Objectives mapping (SO1–SO6 → what to show)

| Objective | Evidence in demo |
|---|---|
| SO1 Data collection system | Supabase schema, ESP32 + browser loggers |
| SO2 Feature engineering | `src/config.py` feature groups, `features.csv` |
| SO3 State modelling | KMeans states, `state_profiles.csv`, silhouette 0.773 |
| SO4 Transition modelling | `transition_probabilities.csv` (0→0 = 0.875 stickiness) |
| SO5 Context-aware evaluation | ablation + cross-context tables |
| SO6 Integration | schema-1.0 JSON export (`src/integration/export.py`), demo UI |
