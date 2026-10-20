# Code Structure & Viva Preparation (J26-DS-307)

Contents:
1. [Repository structure (clean map)](#1-repository-structure)
2. [Data science pipeline in one page](#2-ds-pipeline-one-page)
3. [Viva Q&A — Data collection & data](#3-viva-qa--data--collection)
4. [Viva Q&A — Feature engineering](#4-viva-qa--feature-engineering)
5. [Viva Q&A — Models](#5-viva-qa--models)
6. [Viva Q&A — Evaluation & DS methodology](#6-viva-qa--evaluation--methodology)
7. [Viva Q&A — Honest limitations & tough questions](#7-limitations--tough-questions)

---

## 1. Repository structure

```
J26-DS-307/
├── doc/                            # proposal PDF, assessment criteria, demo docs
│
├── Student_DataCollection_UI/      # ── DATA ACQUISITION SYSTEM (SO1) ──
│   ├── supabase/schema.sql         # 7-table Postgres schema (students, study_sessions,
│   │                               #   environment_logs, behavior_logs, vision_logs,
│   │                               #   concentration_logs, telemetry_streams)
│   ├── hardware/
│   │   ├── esp32/sensor_reader.ino # firmware: temp/humidity/light/noise/motion
│   │   ├── serial_reader.py        # serial → parser
│   │   ├── behavior_logger.py      # keyboard/mouse/idle/app → Supabase
│   │   ├── vision_logger.py        # face/gaze/head/phone → Supabase
│   │   ├── supabase_client.py      # REST writes
│   │   └── run_all.sh              # orchestrator
│   ├── backend/                    # FastAPI collection API
│   └── frontend/                   # Next.js UI: register, start/pause session,
│       │                           #   1 Hz behaviour snapshot (hooks/use-behavior.tsx),
│       │                           #   ESP32 serial parse in browser (lib/esp32-parse.ts)
│
└── FocusTrack_Component1/          # ── ML / RESEARCH COMPONENT (SO2–SO6) ──
    ├── README.md                   # component overview (start here)
    ├── src/
    │   ├── config.py               # ⭐ single source of truth: feature groups,
    │   │                           #   context codes, paths, seeds, constants
    │   ├── pipeline.py             # end-to-end orchestration
    │   ├── simulation.py           # synthetic data generator (demo/fallback)
    │   ├── database/               # Supabase client + table export
    │   ├── preprocessing/          # cleaning, sync, session segmentation, windowing
    │   ├── features/               # keyboard/mouse/app/temporal feature builders
    │   ├── states/                 # KMeans/GMM state discovery + profiling
    │   ├── transitions/            # transition features + matrices (SO4)
    │   ├── context/                # context encoding + holdout (SO5)
    │   ├── models/
    │   │   ├── dataset.py          # session-level dataset assembly
    │   │   ├── train.py            # RF / SVM / XGBoost training + CV
    │   │   └── sequential.py       # DiscreteHMM: Baum-Welch + Viterbi
    │   ├── evaluation/
    │   │   ├── splits.py           # StratifiedGroupKFold, cross-context split
    │   │   ├── metrics.py          # Macro-F1, balanced acc, ROC-AUC
    │   │   ├── experiments.py      # ablation × model × split grid
    │   │   ├── sequential_experiments.py  # HMM representation experiments
    │   │   └── statistics.py       # Wilcoxon, t-test, Cohen's dz, Cliff's delta
    │   ├── integration/export.py   # schema-1.0 behavioural output contract
    │   ├── analysis/learning_type.py      # screen vs non-screen analysis
    │   └── visualization/          # plotting helpers
    ├── scripts/run_pipeline.py     # CLI entry point
    ├── notebooks/01_exploratory_analysis.ipynb   # EDA
    ├── ui/                         # FastAPI demo UI
    │   ├── app.py                  # routes, labelling rules, health
    │   ├── sources.py              # real ↔ synthetic toggle
    │   ├── session_infer.py / focus.py / live.py
    │   └── static/                 # index, session-demo, focus, live pages
    ├── tests/                      # 100+ pytest tests (features→UI)
    ├── data/                       # REAL Supabase pilot: raw/ processed/ features/
    │                               #   sequences/ models/ results/
    └── data/synthetic/             # SYNTHETIC demo data + full results
```

**Key artifact files** (what you point at during the viva):

| File | Meaning |
|---|---|
| `data/results/run_manifest.json` | run config: events, windows, states, cluster quality |
| `data/features/features.csv` | window-level feature matrix |
| `data/features/state_profiles.csv` | interpretable state descriptions |
| `data/features/session_dataset.csv` | session-level model input |
| `data/results/experiment_summary.csv` | all model × representation × split scores |
| `data/results/sequential_summary.csv` | HMM vs non-HMM comparison |
| `data/results/statistics_comparison.csv` | significance tests vs baseline |
| `data/results/transition_probabilities.csv` | state transition matrix |
| `data/results/component1_final_outcomes/` | demo-ready session narratives |

---

## 2. DS pipeline (one page)

```
[ESP32 + browser + vision loggers] → Supabase (7 tables)
        ↓  raw events (1 Hz)
preprocessing: cleaning → timestamp sync → session segmentation
        ↓
60 s sliding windows  (window_seconds=60, also supports 300)
        ↓
feature engineering: baseline | temporal | state | transition | context
        ↓
unsupervised state discovery: KMeans k=4 (GMM alternative)  ← no labels used
        ↓
transition features + context encoding
        ↓
session-level aggregation (mean/std) → labelled dataset
        (label = floor(mean(self-report 1–5) + 0.5), positive ≥ 3.5)
        ↓
training: RF / SVM / XGBoost  +  Discrete HMM (Baum-Welch, Viterbi)
        ↓
evaluation: 5-fold StratifiedGroupKFold (group=participant)
            × cross-context holdout × ablation × statistical tests
        ↓
export: JSON/CSV artifacts → demo UI
```

---

## 3. Viva Q&A — Data & collection

**Q: Where does the data come from?**
Three modalities: (1) ESP32 node — temperature, humidity, light, noise, motion;
(2) browser behaviour logger at 1 Hz — keyboard count, mouse distance/clicks, idle
time, active application; (3) vision logger — face detected, eye gaze, head
direction, phone detected. Stored in Supabase/Postgres (7 tables).

**Q: What is your dataset size?**
Real pilot: 2,636 events → 94 windows from 2 sessions (pilot stage). Synthetic
demo: 27,000 events → 450 windows from 45 sessions. Window size = 60 s.

**Q: What is the target variable?**
Self-reported concentration level 1–5 per session
(`concentration_logs.level`): 1 Fully Distracted, 2 Somewhat Distracted,
3 Neutral, 4 Engaged, 5 Deep Focus. Session label = `floor(mean + 0.5).clip(1,5)`;
binary task uses positive ≥ 3.5.

**Q: Is it supervised or unsupervised?**
Both. State discovery (KMeans/GMM/HMM) is **fully unsupervised and never sees
labels** — that's a deliberate anti-leakage design. Concentration prediction is
supervised on the self-report labels.

**Q: How do you handle missing/noisy data?**
Preprocessing module (`src/preprocessing/`) does cleaning, timestamp
synchronisation, session segmentation and imputation before windowing; windows
with insufficient coverage are dropped. `tests/` verify behaviour on malformed
inputs.

**Q: Class imbalance?**
Class weights: `class_weight='balanced'` on RF and SVM; primary metric is
**Macro-F1** rather than accuracy, so majority-class guessing scores poorly.

---

## 4. Viva Q&A — Feature engineering

**Q: What features do you engineer? (Answer in five groups — all in `src/config.py`)**

1. **Baseline / aggregated** (proposal §3.9): `key_event_count`, `typing_rate`
   (keys/min), `mouse_distance`, `mouse_clicks`, `idle_ratio`
   (idle seconds / window length), `application_switch_count`,
   `unique_application_count`.
2. **Temporal**: `burst_count`, `mean_burst_duration`, `mean_burst_length`
   (activity bursts separated by idle gaps), `mean/std/max_keyboard_count`,
   `mean/std_mouse_velocity`, `mean_mouse_acceleration`, `mean_idle_time`,
   `application_switch_frequency`, `session_progress`, plus window-over-window
   deltas/rolling statistics.
3. **State**: `interaction_state` — discrete cluster id from KMeans (k=4).
4. **Transition**: `previous_state`, `transition_type`, `state_duration`,
   `state_change_rate`, `state_entropy`, `stable_state_duration`,
   `interruption_count`, `recovery_count`.
5. **Context**: `context_code` for task type (reading/coding/writing/zoom/
   assignment), plus location and learning type (screen vs non-screen).

**Q: Why 60-second windows?**
Behavioural signals like typing rate are stable over a minute; shorter windows are
noisy, longer ones dilute transient disengagement. 300 s is also supported
(`WINDOW_SIZES_SECONDS = (60, 300)`) for sensitivity analysis. Overlap gives more
samples but folds are grouped by participant so it doesn't leak.

**Q: Why aggregate to session level?**
The classification target (self-report) is per session, so window features are
aggregated (mean/std) to one row per session (`session_dataset.csv`). This also
prevents window-level pseudo-replication.

**Q: How do you encode categorical context?**
Deterministic integer codes (`CONTEXT_CODES` in `config.py`) so artifacts are
reproducible; identifiers/labels are excluded from features via `NON_FEATURE_COLS`
(e.g. `participant_id`, `session_id`, `focus_label` are never model inputs).

**Q: What is feature selection / ablation?**
Rather than a single selected feature set, we run an **ablation study**: proposed
representation minus one group at a time (`ablation_no_temporal`, `ablation_no_context`,
`ablation_no_transition`, `ablation_no_state`) vs `baseline`. This measures each
group's marginal contribution — it's the answer to RQ2.

**Q: Any feature scaling?**
Yes for SVM: `StandardScaler` inside the pipeline (distance-based model needs it).
Tree models are scale-invariant so no scaling there.

---

## 5. Viva Q&A — Models

**Q: Which models did you use and why?**
Three supervised families as *candidates* (proposal §3.9):
- **Random Forest** — 300 trees, `class_weight='balanced'`; robust non-linear
  baseline, handles mixed features, little tuning.
- **SVM (RBF)** — C=1.0, balanced class weights, StandardScaler pipeline;
  strong on small-n, high-dimensional data.
- **XGBoost** — 300 estimators, max_depth 4, lr 0.1, subsample 0.9; gradient
  boosting usually wins on tabular data.

**Q: What unsupervised model do you use?**
**KMeans with k=4** (default, `random_state=42`) over window features to discover
interaction states; **GMM** as a probabilistic alternative. State quality measured
by **silhouette 0.773**, Davies-Bouldin 0.676, Calinski-Harabasz 142.6 (real run).
`state_profiles.csv` interprets each state (e.g. State 0 = idle-heavy writing,
State 1 = high typing intensity).

**Q: How did you choose k=4?**
Cluster-selection metrics (silhouette / Davies-Bouldin) across candidate k, plus
interpretability — 4 states map cleanly to low/medium/high engagement profiles.
(If asked for the sweep, point at `src/states/` validation module and mention
k is a config constant `DEFAULT_N_STATES = 4`.)

**Q: Explain the HMM.**
Discrete (multinomial) HMM over interaction states: **3 hidden states**,
observation alphabet = 4 interaction states.
- **Baum-Welch (EM)** for MLE of π, A, B — 60–100 iterations, tol 1e-4,
  **3 random restarts**, best log-likelihood kept (implementation in
  `src/models/sequential.py`; optimised 11× with a local log-sum-exp — see git log).
- **Viterbi** decodes the most likely hidden-state sequence.
- Hidden states become features in the `proposed_hmm` representation.
- Outputs: `hmm_hidden_transitions.csv` (near-absorbing hidden states with
  self-loop ≈ 1.0).

**Q: Why an HMM if you already have states?**
KMeans gives memoryless states; the HMM adds **temporal dependence** — the
probability of the current state depends on the previous one (persistence,
interruption, recovery). It models *dynamics*, not just snapshots.

**Q: Which model performed best?**
Macro-F1, participant split: **SVM with the proposed representation** — 0.589
synthetic, 0.534 real. Best overall synthetic row: no-transition+SVM 0.623.
Baseline+RF 0.464, baseline+SVM 0.373. On cross-context shift the gap widens:
proposed+SVM 0.377 vs baseline+SVM 0.083.

**Q: Did the HMM help?**
Honestly: **not much on synthetic data** — proposed 0.589 vs proposed_hmm 0.543
(SVM), RF unchanged (0.511), XGB slightly up (0.447 → 0.455). Interpretation:
the hand-engineered transition features already encode most of the sequential
information, leaving little for the HMM to add. We report this rather than hide it.

**Q: Hyperparameters — are they tuned?**
Values are fixed defaults in `src/config.py` / `src/models/train.py`
(`RANDOM_STATE = 42` for reproducibility). If pressed: the research focus is
representation comparison (ablation) under a *fixed* model budget, so that model
capacity doesn't confound the representation effect — a deliberate controlled-
experiment choice. Grid search is listed as future work.

---

## 6. Viva Q&A — Evaluation & methodology

**Q: What is your evaluation metric and why?**
**Macro-F1** (primary) — unweighted mean of per-class F1, robust to class
imbalance. Secondary: balanced accuracy, accuracy, macro precision/recall, ROC-AUC.

**Q: What validation scheme?**
- **5-fold StratifiedGroupKFold**, `groups = participant_id/session_id`: windows
  from the same participant never appear in both train and test → prevents
  subject leakage, the classic pitfall in wearables/behaviour sensing.
- **Cross-context holdout**: train on some task types/locations, test on unseen
  ones — measures generalisation, the harder and more honest number.

**Q: What is your baseline?**
Two baselines: (1) **representation baseline** = conventional aggregated features
only (`BASELINE_SESSION_COLS`); (2) the proposed = baseline + temporal + states +
transitions + context. RQ2 is answered by proposed > baseline.

**Q: How do you know the difference is significant?**
Paired per-fold comparison of proposed vs baseline (`statistics.py`):
Wilcoxon signed-rank, paired t-test, **Cohen's dz**, **Cliff's delta**, bootstrap
95% CI. Headline: synthetic SVM proposed vs baseline Δ **+0.216**, CI
[0.080, 0.352], dz **1.24**; best contrast Δ +0.249, dz 1.87, **p = 0.014**.

**Q: How do you avoid data leakage?**
1. States/clusterers fitted **without labels**.
2. Grouped CV → no participant overlap across folds.
3. Identifiers and label columns listed in `NON_FEATURE_COLS` are excluded from X.
4. Scaling inside the CV pipeline (fit on train fold only).
5. `RANDOM_STATE = 42` for reproducibility; `run_manifest.json` records the config.

**Q: What about the screen vs non-screen research question?**
`src/analysis/learning_type.py` splits analysis by `students.learning_type`;
context features and the cross-context split test whether the representation
transfers between screen (coding/zoom) and non-screen (reading/writing) tasks.

**Q: How is this reproducible?**
`python scripts/run_pipeline.py --source synthetic` regenerates every artifact;
100+ pytest tests; manifest records event counts, window size, k, seed, and
cluster metrics.

---

## 7. Limitations & tough questions

| Likely question | Your answer |
|---|---|
| "Your real data is only 2 sessions." | Correct — pilot stage; the pipeline, schema and full experiment grid are validated on synthetic (45 sessions), and the real run proves end-to-end feasibility (silhouette 0.773). Recruiting participants for the full study is the next phase. |
| "Isn't a self-reported label weak?" | Yes, it's noisy — but it's the ethical ground truth without invasive EEG. We mitigate with session-level averaging, balanced class weights and Macro-F1; states themselves are label-free. |
| "The HMM didn't help — why keep it?" | Honest negative result; transition features already capture the dynamics at this data size. HMM may pay off with longer sequences/more data; we report both. |
| "Isn't 60 s window overlapping = data leakage?" | No — grouping by participant in CV means correlated windows can't straddle train/test. |
| "Why not deep learning (LSTM/Transformer)?" | Sample size (45 sessions) is far too small; tree/SVM models are the right capacity. Deep sequence models are future work once hundreds of sessions exist. |
| "KMeans assumes spherical clusters." | True; GMM is implemented as the alternative with soft assignments. Cluster validity (silhouette/DB/CH) is reported rather than assumed. |
| "How is this not just activity level predicting focus?" | That's exactly what the ablation tests: context/transition/state groups add Δ+0.216 over activity-only baseline, and the cross-context gap (0.377 vs 0.083) shows it isn't just raw activity. |
| "XGBoost errors on the real run." | Known issue: `base_score must be in (0,1)` with only 2 sessions/tiny class counts; documented, and the demo uses the synthetic source for that cell. |
| "What is the novelty?" | Combining **unsupervised interaction states + transition dynamics + explicit learning context** into one representation for concentration assessment, evaluated with participant-level and cross-context protocols most behaviour-modelling work skips. |

### 60-second closing statement

> "FocusTrack turns passive behavioural signals from an ESP32 node and browser into
> 60-second windows, engineers five feature groups, discovers label-free interaction
> states with KMeans and models their dynamics with an HMM. Against a conventional
> aggregated-feature baseline, our context-aware representation improves Macro-F1 by
> 0.22 (Cohen's dz 1.24, p = 0.014 on the strongest contrast) and is dramatically
> more robust under cross-context shift — 0.377 versus 0.083 for SVM. Validation is
> participant-grouped 5-fold CV with ablation and significance testing; the pilot
> real dataset is small, and expanding it is the immediate next step."
