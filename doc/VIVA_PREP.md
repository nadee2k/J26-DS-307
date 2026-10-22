# Code Structure & Viva Preparation (J26-DS-307)

**Component 1 — Context-Aware Learner Interaction-State Modelling** (Kumari M.A.D.N.)

> **Read this before quoting a number.**
> Every score in this document comes from the **simulated snapshot**
> (`data/raw/simulated_seed2026/`, 22 participants). It proves the pipeline runs;
> it is **not a research finding**. `research/docs/DECISIONS.md` D001 forbids
> reporting it as one.
>
> **Authoritative sources** (check these, not this document, if they disagree):
> `research/artifacts/results/summary.csv`, `statistics.csv`, `by_mode.csv`,
> `research/artifacts/states/state_manifest.json`,
> `research/artifacts/export/manifest.json`, `research/docs/DECISIONS.md`.
>
> This file was rewritten to match the current `research/` pipeline. Older notes
> referencing KMeans, a 3-state Discrete HMM, 5-fold CV, or `FocusTrack_Component1/`
> describe a superseded implementation.

Contents:
1. [Repository structure](#1-repository-structure)
2. [Data science pipeline in one page](#2-ds-pipeline-one-page)
3. [Models trained, why, and accuracy](#3-models-trained-why-and-accuracy)
4. [Viva Q&A — Data and labels](#4-viva-qa--data-and-labels)
5. [Viva Q&A — Features and representation](#5-viva-qa--features-and-representation)
6. [Viva Q&A — Models](#6-viva-qa--models)
7. [Viva Q&A — Evaluation and statistics](#7-viva-qa--evaluation-and-statistics)
8. [Viva Q&A — Deployment and engineering](#8-viva-qa--deployment-and-engineering)
9. [Limitations and tough questions](#9-limitations-and-tough-questions)
10. [60-second closing statement](#10-60-second-closing-statement)

---

## 1. Repository structure

```
J26-DS-307/
├── doc/                              # proposal, assessment criteria, demo notes, this file
│   ├── FocusTrack_Proposal_Report_C1_Kumari_IT23211032.docx
│   ├── PP1_Assessment_Criteria.pdf
│   ├── DEMO_SUMMARY.md               # demo script (partly stale — see note at end)
│   └── VIVA_PREP.md                  # this file
│
├── research/                         # ── AUTHORITATIVE ML PIPELINE (SO2–SO6) ──
│   ├── configs/
│   │   ├── base.yaml                 # shared constants: epoch, probes, features, paths
│   │   ├── c1_baseline.yaml          # aggregated features only
│   │   ├── c1_proposed.yaml          # HMM states + transitions + context
│   │   └── c1_ablation.yaml          # full / no_context / no_states / no_transitions / baseline
│   ├── data/
│   │   ├── raw/simulated_seed2026/   # immutable snapshot: sessions, epochs, probes
│   │   └── processed/                # generated: features, labels, states, representation
│   ├── src/focustrack/
│   │   ├── config.py                 # canonical columns, feature groups, paths
│   │   ├── io/                       # simulated / CSV / Supabase loaders
│   │   ├── prep/                     # cleaning, clock alignment, epoch windows
│   │   ├── features/                 # keyboard, mouse, app, temporal features
│   │   ├── labels/                   # probe windows + learner-normalised labels
│   │   ├── states/                   # Gaussian HMM, BIC selection, stability, profiles
│   │   ├── transitions/              # dwell, changes, interruption, recovery
│   │   ├── context/                  # task / study-mode encoding + interactions
│   │   ├── models/                   # majority, logreg, SVM, RF, XGBoost
│   │   ├── pipeline/fold.py          # per-fold refit (scaler, HMM, imputation)
│   │   └── evaluation/               # LOPO/LOTO splits, metrics, statistics
│   ├── scripts/                      # build_features, run_states, run_experiments, export
│   ├── contracts/                    # c1_features.json + c1_fixture.json (web contract)
│   ├── tests/                        # pytest suite (38 test functions)
│   ├── notebooks/                    # EDA only — never production logic
│   └── artifacts/
│       ├── states/                   # state_selection, state_profiles, manifest
│       ├── results/                  # summary, metrics, per_participant, statistics, by_mode
│       ├── runs/full/, runs/quick/   # full + smoke run outputs
│       └── export/manifest.json      # deployed model provenance
│
├── FocusTrack_PP1_Demo/              # ── CAPTURE APP + LIVE UI (PP1) ──
│   ├── frontend/                     # Next.js UI; loads public/models/c1.json
│   ├── backend/                      # FastAPI: epoch storage, scoring endpoint
│   ├── hardware/python_bridge/       # desktop agent: key timing + Backspace
│   └── supabase/                     # schema + C1 epoch migration
│
└── FocusTrack_Integrated_Demo/       # ── DEMO: login → session → outcome → progress ──
    ├── app/ components/ hooks/ lib/  # offline, deterministic Next.js demo
    └── scripts/
```

> Older documents mention `FocusTrack_Component1/` and `Student_DataCollection_UI/`.
> Those are **not in the current working tree**; their roles are now filled by
> `research/` (ML) and `FocusTrack_PP1_Demo/` (capture + UI).

**Key artifact files to point at during the viva**

| File | Meaning |
|---|---|
| `research/data/processed/manifest.json` | 22 participants, 132 sessions, 6,600 epochs, 2,870 labelled |
| `research/data/processed/features.csv` | epoch-level feature matrix (canonical 14 columns) |
| `research/data/processed/labelled_epochs.csv` | EDA labels (not for evaluation) |
| `research/data/processed/c1_representation.csv` | model-ready table: features + states + transitions + context |
| `research/artifacts/states/state_manifest.json` | selected k=4, BIC curve, elbow rule, seed stability, state labels |
| `research/artifacts/states/state_profiles.csv` | per-state means and shares |
| `research/artifacts/results/summary.csv` | mean metrics by split × representation × model |
| `research/artifacts/results/metrics.csv` | one row per fold (338 rows) |
| `research/artifacts/results/statistics.csv` | paired Wilcoxon, bootstrap CI, Cohen's dz |
| `research/artifacts/results/by_mode.csv` | pooled screen vs non-screen |
| `research/artifacts/results/by_task.csv` | per held-out task |
| `research/artifacts/results/run_manifest.json` | config, hashes, git state, package versions |
| `research/contracts/c1_fixture.json` | golden vector + expected probability (Python ↔ JS) |
| `research/artifacts/export/manifest.json` | deployed model provenance + LOPO score |

---

## 2. DS pipeline in one page

```
PP1 capture (browser 1 Hz + desktop agent + ESP32 + vision)
        ↓
cleaning → clock alignment → session segmentation
        ↓
60-second epochs  (config: epoch_seconds = 60)
        ↓
features: 14 canonical columns
  available today: typing_rate, inter_key_cv, backspace_ratio,
                   idle_ratio, mouse_speed_px_s, mouse_path_px, switch_rate
  event-only (NaN): inter_key_mean_ms, burst_count, mean_burst_duration_s,
                   mean_burst_length, click_rate, unique_apps, app_category_entropy
        ↓
unsupervised states: Gaussian HMM (k = 4, diag covariance)
  never sees labels  →  4 interpretable states
        ↓
transition features + task/study-mode context
        ↓
probe labels: a probe at t labels the 5 epochs before it
  rating z-scored within learner; normaliser fitted on TRAIN probes only
        ↓
per-fold representation build (states one-hot, interactions, imputation medians)
        ↓
classifiers: majority, logistic, SVM(RBF), Random Forest, XGBoost
        ↓
evaluation: LOPO (22 folds) × LOTO (4 computer tasks) × ablation × paired tests
        ↓
export: logistic model + feature contract + golden fixture → PP1 web app
```

**Scale of the simulated snapshot**

| Item | Value |
|---|---|
| Participants / sessions | 22 / 132 |
| Epochs / probe-labelled epochs | 6,600 / 2,870 |
| Epoch length | 60 s |
| Focus prevalence | ≈ 60 % positive |
| HMM states | 4 |
| LOPO folds / LOTO folds | 22 / 4 |
| Classifier fits | 338 (13 model-runs × 26 folds) |
| HMM refits | 78 (3 state-using representations × 26 folds) |

---

## 3. Models trained, why, and accuracy

### 3.1 The models

| # | Model | Type | Settings | Why it is used |
|---|---|---|---|---|
| 1 | **Majority** | trivial baseline | predicts training majority | **Sanity floor**, not a candidate. Shows why accuracy alone is misleading. |
| 2 | **Logistic Regression** | linear, probabilistic | `StandardScaler`, `max_iter=1000`, `class_weight=balanced` | Interpretable linear reference; calibrated probabilities; exported to the app. |
| 3 | **SVM (RBF)** | non-linear, margin | `C=1.0`, `rbf`, `probability=True`, scaled | Strong on small-n, higher-dimensional data; reference model for the ablation (D012). |
| 4 | **Random Forest** | bagged trees | `n_estimators=300`, `class_weight=balanced` | Robust non-linear baseline; mixed/correlated features; little tuning. |
| 5 | **XGBoost** | gradient boosting | `n_estimators=300`, `max_depth=4`, `lr=0.1`, `subsample=0.9`, `colsample_bytree=0.9`, `scale_pos_weight=n_neg/n_pos` | Tests whether boosting beats bagging on this tabular data. |
| 6 | **Gaussian HMM** | unsupervised states | 4 states, `covariance_type=diag`, `n_iter=200`, `tol=1e-4` | Creates interaction states + transitions (the novelty). Never sees labels. Refit per fold. |
| 7 | **Deployed LR** (`c1-web-1.0.0`) | linear, probabilistic | 10 live app features, 5-epoch smoothing | Browser cannot decode an HMM; a reduced logistic model is exported (D013). |

Classifier hyperparameters are **deliberately fixed** (D012): the research question
is the representation, so model capacity must not explain a difference. SVM is the
ablation model because it performed best on this data.

### 3.2 Accuracy and macro-F1 — LOPO (leave-one-participant-out, 22 folds)

Primary metric is **macro-F1**; accuracy is shown for reference only.

| Model | Baseline F1 | Baseline Acc | Proposed F1 | Proposed Acc |
|---|---|---|---|---|
| Majority | 0.3035 | 0.4970 | 0.3035 | 0.4970 |
| **Logistic** | 0.5121 | 0.5932 | **0.5237** | 0.5862 |
| **SVM** | 0.5028 | **0.6073** | 0.5186 | 0.5806 |
| Random Forest | 0.5130 | 0.5757 | 0.4958 | 0.5591 |
| XGBoost | 0.5063 | 0.5693 | 0.5016 | 0.5575 |

Ablations (SVM only): no_context **0.5214** / 0.5790 · no_states **0.4891** / 0.5720 ·
no_transitions **0.4925** / 0.5758.

### 3.3 Accuracy and macro-F1 — LOTO (leave-one-task-out, 4 computer tasks)

| Model | Baseline F1 / Acc | Proposed F1 / Acc |
|---|---|---|
| Logistic | 0.6031 / 0.6158 | 0.5382 / 0.5839 |
| SVM | 0.5974 / 0.6101 | 0.5496 / 0.5801 |
| **Random Forest** | 0.5757 / 0.5893 | **0.6044** / 0.6136 |
| XGBoost | 0.5768 / 0.5891 | 0.5691 / 0.5856 |
| Majority | 0.3290 / 0.5002 | 0.3290 / 0.5002 |

> LOTO is **not comparable** to LOPO: the same participants appear on both sides,
> because LOTO only holds out the task (D011). LOTO answers "does the
> representation transfer to an unseen task?", not "does it generalise to a new
> learner?".

### 3.4 What the numbers actually say

- Best LOPO cell: **proposed + Logistic, macro-F1 0.5237**.
- Best LOTO cell: **proposed + Random Forest, 0.6044**.
- Removing states costs the most: 0.5186 → 0.4891 (p = 0.059).
- Removing transitions costs 0.026 (p = 0.098); removing context changes nothing
  meaningful (−0.003, p = 0.526).
- **No LOPO difference is significant at α = 0.05.** Proposed-vs-baseline
  p-values range 0.22–0.66. Say this plainly.
- The clearest signal is **non-screen** sessions: proposed SVM 0.499 vs baseline
  SVM 0.380 (+0.119), while screen only moves 0.618 → 0.645 (+0.027).
- Deployed model (`c1-web-1.0.0`): LOPO macro-F1 **0.541**, per-participant range
  0.388–0.699.

### 3.5 Why other models are not used

| Not used | Reason |
|---|---|
| **Deep learning (LSTM / Transformer / CNN)** | Only 2,870 labelled rows from 22 participants. Too little data to fit sequence models; they would memorise participants. Future work with hundreds of sessions. |
| **kNN** | Degrades with correlated, differently-scaled features; no feature importance; no gain at this n. |
| **Naive Bayes** | Assumes conditional independence, but `typing_rate`, `idle_ratio`, `switch_rate` are strongly correlated. |
| **Single decision tree** | High variance, unstable; RF is the strictly better version of the same idea. |
| **LightGBM / CatBoost / AdaBoost** | Redundant with XGBoost. No high-cardinality categoricals for CatBoost; one booster keeps the grid small and comparable. |
| **MLP / AutoML** | Small tabular data, large tuning burden, no expected gain; would break the fixed-model-budget design. |
| **PCA / automatic feature selection** | The study tests *representations* via ablation; PCA would destroy the interpretability of the feature groups. |
| **SMOTE / oversampling** | Synthetic neighbours can leak across participants in grouped CV; `class_weight=balanced` is safer. |
| **KMeans / GMM as the state model** | Replaced by the Gaussian HMM because KMeans is memoryless — it cannot model persistence, interruption or recovery. |
| **HMM as a classifier** | It is a representation, not a predictor. Its contribution is measured by the `no_states` ablation, not by its own F1. |
| **Grid search / tuning** | Deliberate: fixed hyperparameters so model capacity cannot explain a representation difference (D012). |

**One-sentence justification:** *"The research question is about representation,
not model tuning, so every representation is evaluated with the same fixed model
budget; SVM is the reference model for the ablation because it performed best on
this data."*

---

## 4. Viva Q&A — Data and labels

**Q1. Where does the data come from?**
Three modalities: (1) ESP32 node — temperature, humidity, light, noise, motion;
(2) browser + desktop agent — keyboard timing, mouse, idle time, active
application, Backspace flag; (3) vision logger — face, gaze, head direction,
phone. Stored in Supabase/Postgres.

**Q2. How big is the dataset?**
The committed snapshot is simulated: 22 participants, 132 sessions, 6,600
one-minute epochs, 2,870 probe-labelled epochs. The real pilot is much smaller
and is not what the reported numbers come from.

**Q3. What is the target variable?**
Self-reported concentration 1–5 per session. A probe at epoch `t` labels the five
epochs before it (`probe_window_epochs = 5`). Ratings are z-scored within learner;
"focused" is z > 0, and a "focus drop" is z ≤ −1.

**Q4. Why not use the raw 1–5 rating as the label?**
Learners use the scale differently — one person's 4 is another's 2. Within-learner
z-scoring removes that offset. It also gives a defensible binary target.

**Q5. How do you avoid label leakage in LOPO?**
The held-out participant has no training ratings, so the normaliser uses the
**training-population** mean and SD (`label_normalisation: train_population`).
Using the test participant's own probes would leak the test label distribution
(D002).

**Q6. Isn't a self-report label weak?**
Yes. It is noisy but ethical — no EEG or eye-tracker ground truth is available.
Mitigations: five-epoch probe windows, within-learner normalisation, balanced
class weights, macro-F1, and states that never see labels.

**Q7. Is the simulator hiding the answer?**
No. The snapshot exports observable fields only; the hidden focus process is
deliberately not written, so no analysis can accidentally use simulator truth
(D001).

**Q8. What is the class balance?**
About 60 % focused. That is why accuracy is a poor primary metric: the majority
class gets 0.497 accuracy but only 0.303 macro-F1.

---

## 5. Viva Q&A — Features and representation

**Q9. What features do you compute?**
Fourteen canonical columns in `config.py`: typing rate, inter-key mean/CV,
Backspace ratio, burst count/duration/length, mouse path/speed, click rate, idle
ratio, switch rate, unique apps, app-category entropy. `mouse_path_px` is derived
as speed × duration.

**Q10. Which features are actually available?**
Seven: `typing_rate`, `inter_key_cv`, `backspace_ratio`, `idle_ratio`,
`mouse_speed_px_s`, `switch_rate`, `mouse_path_px`. The other seven need
event-level key timestamps or app names the PP1 logger does not persist, so they
are `NaN` with `is_missing_*` flags (D003). `inter_key_cv` and `backspace_ratio`
are also masked below 10 keys/min because rhythm is undefined in a quiet epoch.

**Q11. Why 60-second epochs?**
Typing rate and idle ratio are stable over a minute; shorter windows are noisy,
longer ones blur transient disengagement. The proposal also supports 300 s for
sensitivity analysis.

**Q12. What are the five representation groups?**
1. **Aggregated** — typing, idle, mouse speed, switch rate.
2. **Temporal** — conditional rhythm/correction features + missing flags.
3. **States** — one-hot HMM state (k−1 columns).
4. **Transitions** — interruption, dwell, changes in 5 min, time since
   interruption, censoring, recovery, recovered.
5. **Context** — `is_screen`, task one-hots (reference = reading), screen ×
   activity, state × screen, state × task.

**Q13. How many features per representation?**
Baseline 4; no_context 19; no_states 14–17; no_transitions 27–35; proposed 35–43.
The range is because a column with no training variance (e.g. a task absent from
a fold) is dropped inside that fold.

**Q14. Why encode context as interactions, not just a task ID?**
A task ID shifts the intercept; interactions let the *effect* of typing or
switching differ by task and state. That is the context-aware claim.

**Q15. What is the ablation for?**
It answers RQ2: proposed minus one group at a time shows each group's marginal
contribution. It is not feature selection — no group is discarded from the final
model.

**Q16. Why are identifiers and labels excluded?**
`participant_id`, `session_id`, `focus_label`, probe ratings and task
descriptions are in `NON_FEATURE_COLS`/`ID_COLUMNS`, never in X. Otherwise the
model could learn the participant rather than the behaviour.

**Q17. Do you scale features?**
Yes, `StandardScaler` inside the pipeline for logistic and SVM — fitted on the
training fold only. Trees are scale-invariant, so RF/XGBoost skip it.

---

## 6. Viva Q&A — Models

**Q18. Which models did you use and why?**
Five classifiers — majority (floor), logistic (interpretable linear), SVM-RBF
(small-n non-linear reference), Random Forest (robust bagging), XGBoost
(boosting). Plus a Gaussian HMM for label-free states and a deployed logistic
model. See §3.1.

**Q19. Why include a majority classifier?**
It is the honest floor. If a model cannot beat 0.303 macro-F1, the representation
adds nothing. It also exposes that accuracy is misleading under imbalance.

**Q20. Why is SVM the ablation model but all five reported for baseline/proposed?**
SVM was the strongest on this data, so it gives the cleanest representation
comparison. Running all five on every ablation would triple the runtime without
changing the conclusion.

**Q21. Are hyperparameters tuned?**
No — fixed defaults (D012). The experiment is a controlled comparison of
representations. Grid search is future work, and tuning per representation would
confound the result.

**Q22. Why do RF and XGBoost lose to logistic on LOPO?**
With 22 participants and correlated features, high-variance models overfit
participant idiosyncrasies. A regularised linear model is the better bias–variance
trade-off at this n. This is a legitimate result, not a bug.

**Q23. Why keep XGBoost if it never wins?**
It is the expected strong tabular baseline. Reporting it and showing it does not
win is more credible than omitting it.

**Q24. What does `class_weight='balanced'` do?**
It reweights the loss inversely to class frequency, so the minority ("not focused")
class is not ignored. XGBoost gets the equivalent `scale_pos_weight = n_neg/n_pos`.

**Q25. Why a Gaussian HMM and not KMeans?**
KMeans gives memoryless clusters. The HMM models the probability of the current
state given the previous one — persistence, interruption, recovery — which is the
temporal claim of the proposal.

**Q26. How did you choose four states?**
BIC was computed for k = 2–6 over five seeds. Median BIC keeps falling, so there
is no interior minimum; the rule stops at the smallest k after which adding a
state improves BIC by less than 10 % of the total gain, which gives k = 4 (D007).
The full curve is in `state_manifest.json`, so the choice is auditable.

**Q27. Why fix k across folds but refit the HMM?**
k is a representation design decision; running BIC inside 22 folds would make the
representation depend on the test participant and cost 22 × 25 extra fits (D010).
The parameters, scaler and state labels are refit on each training fold.

**Q28. How do you prove the HMM never saw labels?**
`HMMStateModel.fit` receives only the four behavioural features, never
`focus_label`. The per-fold pipeline builds representations from training epochs
only, and the test participants are decoded with the training HMM.

**Q29. What do the four states mean?**
Idle/away, Sustained typing, Browsing/light activity, Frequent switching. They
come from the state means in `state_profiles.csv`, not from manual assignment.

**Q30. Why does removing states hurt more than removing transitions?**
The state one-hots carry the coarse activity regime; transitions refine timing
within it. Removing states also removes the state × context interactions, so the
loss is larger.

**Q31. What is the deployed model, and why is it different?**
`c1-web-1.0.0` is a logistic regression on the ten inputs the browser can produce
(six epoch features, screen mode, three screen interactions) with five-epoch
smoothing. The browser cannot decode a Gaussian HMM or serve XGBoost without a
backend (D013). Its LOPO macro-F1 is 0.541 for a different representation, so it
is not directly comparable to the 0.519 SVM result.

**Q32. Why not use the HMM inside the app?**
It needs a backend decoder or an ONNX export. The FastAPI backend already exists;
moving the full representation there is the next engineering step, with the same
feature contract and fixture test.

---

## 7. Viva Q&A — Evaluation and statistics

**Q33. What is the primary metric?**
Macro-F1 — the unweighted mean of per-class F1. It penalises majority-class
guessing and treats both classes equally. Secondary: balanced accuracy, accuracy,
macro precision/recall, ROC-AUC.

**Q34. What are the validation schemes?**
LOPO: hold out one participant, 22 folds — the participant-generalisation result.
LOTO: hold out one computer task (coding, writing, assignment, zoom), 4 folds —
task transfer. Reading and handwriting are excluded from LOTO because non-screen
learners do not use the computer.

**Q35. Why not 5-fold CV?**
LOPO is stricter and matches the deployment question: a new learner. Five-fold
grouped CV would leave fewer held-out participants per fold and give a less
honest estimate of unseen-learner performance.

**Q36. Can you compare LOPO and LOTO scores?**
No. LOTO reuses participants across train and test, so its scores are inflated
relative to LOPO (D011). Report them separately.

**Q37. Is overlapping windows or five-epoch probe smoothing leakage?**
No, provided the grouping is respected. Folds never split a participant across
train and test, and the label normaliser is fitted on training probes only.

**Q38. Your improvements are not significant. Do you still claim the representation works?**
Not as a finding. On the simulated snapshot the direction is consistent for
logistic and SVM, and the ablation points at states and transitions, but
p-values are 0.059–0.66. The claim is that the protocol is valid and the pipeline
is reproducible; the effect size must be re-tested on real participants.

**Q39. What do the statistics add?**
Paired Wilcoxon signed-rank on per-participant LOPO scores, bootstrap 95 % CI,
and Cohen's dz. They stop you from reading noise as an improvement — which is
exactly what happens to XGBoost here (Δ −0.005).

**Q40. Why is the non-screen result the most promising?**
Baseline non-screen SVM macro-F1 is 0.380 versus 0.499 for the proposed
representation (+0.119), while screen moves only +0.027. Context and state
features matter most when the learner is away from the keyboard, which is the
paper's motivation.

**Q41. How do you avoid overfitting the evaluation?**
Fixed hyperparameters, no test-set peeking, one pre-registered split design,
labels excluded from X, all learned transforms refit inside the fold, and every
run writes a manifest with hashes and git state.

---

## 8. Viva Q&A — Deployment and engineering

**Q42. How do you reproduce every number?**
```bash
cd research
make setup        # Python 3.12 + editable install
make data         # features + labels
make states       # HMM, transitions, context
make experiments  # model grid, ablations, statistics
make export       # deployable model + contract
make test
```
`run_manifest.json` records config, data hashes, package versions and git state.

**Q43. Where are the trained models stored?**
Not stored. Every fold refits its scaler, HMM, state labels and imputation
medians, so a binary would be one arbitrary fold. The artifacts are the metrics,
predictions and the exported JSON model. This is a deliberate reproducibility
choice.

**Q44. How does the web app stay in sync with the research model?**
`contracts/c1_features.json` fixes feature order and units;
`contracts/c1_fixture.json` holds a golden vector and expected probability. Both
`tests/test_export.py` (Python) and `verify-c1-model.mjs` (Node) reproduce it, so
the two implementations cannot silently drift.

**Q45. Why is the app not training its own model?**
The app is a capture and demonstration layer. Feature definitions, labels, states
and training live in `research/`; the app loads the exported artifact and only
falls back to browser training if it is missing or malformed (D006).

**Q46. What happens if the model file is missing?**
The frontend falls back to browser training so the demo still runs, but that
fallback is a stand-in, not the researched model.

---

## 9. Limitations and tough questions

| Likely question | Your answer |
|---|---|
| "Your data is simulated." | Correct. The snapshot validates the pipeline end to end; `DECISIONS.md` D001 says never report its numbers as findings. Real recruitment is the next phase. |
| "22 participants is small." | Yes. It limits statistical power — that is why no LOPO difference reaches p < 0.05. We report effect sizes and CIs rather than a significance claim. |
| "Isn't a self-report label weak?" | Yes, but it is the ethical ground truth here. Five-epoch windows, within-learner normalisation and macro-F1 mitigate it. |
| "The HMM didn't help much — why keep it?" | It is the mechanism for the temporal claim, and the `no_states` ablation is the worst variant, which supports keeping it. The effect is not yet significant at this n. |
| "Why not deep learning?" | 2,870 labelled rows from 22 participants. Tree/linear models are the right capacity; deep sequence models are future work. |
| "KMeans/GMM would be simpler." | They are memoryless. The HMM adds state persistence and recovery, which is the proposal's contribution. |
| "Isn't this just activity level predicting focus?" | The ablation tests that: removing states costs 0.030 macro-F1, and the non-screen gap is 0.380 → 0.499, not a raw-activity effect. |
| "Why does the deployed model score differ?" | Different representation: ten live browser inputs, not the full HMM + transitions + context (D013). |
| "Why is BIC monotonic? Is k=4 arbitrary?" | Monotonic BIC is expected with continuous Gaussian emissions at n = 6,600; the elbow rule is stated in D007 and the full curve is published, so the choice is auditable, not arbitrary. |
| "What is the novelty?" | Combining label-free HMM interaction states, transition dynamics and explicit task/study-mode context in one representation, evaluated with participant-level and task-transfer protocols. |
| "What would you do with more data?" | Re-select k on real BIC, re-test the states/transitions effect, add event-level features (bursts, clicks, app entropy), and try an ONNX-exported sequence model. |

### Known stale documents

- `doc/DEMO_SUMMARY.md` still describes KMeans k=4, a 3-state Discrete HMM,
  5-fold CV and the old `FocusTrack_Component1/` paths. Do not quote its numbers;
  use `research/artifacts/results/`.
- `doc/VIVA_PREP.md` (this file) is aligned with `research/` as of the last
  rewrite. If you re-run `make experiments`, update §3.2–§3.4.

---

## 10. 60-second closing statement

> "FocusTrack turns passive behavioural signals into 60-second epochs, discovers
> label-free interaction states with a Gaussian HMM, and encodes transition
> dynamics and task context. On the simulated snapshot the proposed
> representation raises LOPO macro-F1 from 0.503 to 0.519 for SVM, and the
> ablation attributes the gain to states (p = 0.059) and transitions (p = 0.098).
> The differences are not yet statistically significant at 22 participants, so
> the current claim is a valid, auditable protocol and a reproducible pipeline —
> not a finding. The most promising signal is non-screen learning, where macro-F1
> rises from 0.380 to 0.499; testing that on real participants is the next step."
