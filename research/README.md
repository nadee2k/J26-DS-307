# Component 1 — research pipeline

**Context-Aware Learner Interaction-State Modelling** (J26-DS-307, Kumari M.A.D.N.)

This folder is the **authoritative data-science implementation** of Component 1.
The PP1 web app (`../FocusTrack_PP1_Demo/`) captures interaction metadata and
serves the learner UI; it does **not** own feature definitions, labels, states or
model training. Those live here.

> The simulated snapshot is pipeline evidence, not research data. Never report
> its numbers as findings.

## Layout

| Path | Purpose | Proposal |
|---|---|---|
| `configs/` | experiment configs (baseline, proposed, ablation) | §3.5–3.8 |
| `data/raw/` | immutable exports (simulated snapshot committed; real data ignored) | §3.3 |
| `data/processed/` | generated feature/label tables (not committed) | §3.4 |
| `notebooks/` | exploration and figures only — no production logic | — |
| `src/focustrack/io/` | simulated, CSV and Supabase loaders | §3.3 |
| `src/focustrack/prep/` | cleaning, clock alignment, session/epoch windows | §3.4.2–3.4.3 |
| `src/focustrack/features/` | keyboard, mouse, application, temporal features | SO2, §3.4.3 |
| `src/focustrack/labels/` | probe windows and learner-normalised labels | §3.2–3.3 |
| `src/focustrack/evaluation/` | LOPO and leave-one-task-out splits | §3.8 |
| `src/focustrack/states/` | Gaussian HMM states, BIC selection, seed stability, profiles | SO3 |
| `src/focustrack/transitions/` | dwell, changes, interruption and recovery features | SO4 |
| `src/focustrack/context/` | task and study-mode encoding, state interactions | SO5 |
| `src/focustrack/models/` | SVM, Random Forest, XGBoost, majority (next phase) | §3.5–3.6 |
| `src/focustrack/pipeline/` | per-fold fit/transform pipeline (next phase) | §3.8 |
| `scripts/` | reproducible entry points | — |
| `tests/` | unit tests for features, labels and splits | — |
| `contracts/` | exported feature contract + golden fixture shared with the web app | §3.4 |
| `artifacts/` | run manifests, fitted models, executed reports, curated results | — |

## Run it

```bash
cd research
make setup                 # uv venv (Python 3.12) + editable install
make data                  # builds data/processed/features.csv + labels
make states                # HMM state discovery, transitions, context
make experiments           # model grid, ablations, paired statistics
make export                # deployable model + contract for the web app
make test                  # pytest
```

`make data` currently reads the committed simulated snapshot:

```
data/raw/simulated_seed2026/{sessions,epochs,probes}.csv
```

It is produced from the PP1 simulator and contains **observable fields only** —
the hidden focus process is deliberately not exported.

To rebuild the snapshot from the demo simulator:

```bash
make sim-data
```

For real data:

```bash
# exported tables with sessions.csv / epochs.csv / probes.csv (+ optional events.csv)
python scripts/build_features.py --source csv --csv-dir path/to/export

# or straight from Supabase (needs SUPABASE_URL and a key in research/.env)
python scripts/build_features.py --source supabase
```

If `events.csv` is present, `features/build_from_events` computes the full
proposal feature set from event metadata. Otherwise the pre-aggregated epoch
table is adapted and event-only features are marked missing.

## Feature availability (current logger vs proposal)

| Feature | Source today | Status |
|---|---|---|
| `typing_rate` | logger / simulator | available |
| `inter_key_cv` | logger / simulator (CV) | available, masked below 10 keys/min |
| `backspace_ratio` | logger / simulator | available, masked below 10 keys/min |
| `idle_ratio` | logger / simulator | available |
| `mouse_speed_px_s` | logger / simulator | available |
| `switch_rate` | logger / simulator | available |
| `mouse_path_px` | derived from speed × duration | available |
| `inter_key_mean_ms` | needs key timestamps | **event-only** |
| `burst_count` | needs key timestamps | **event-only** |
| `mean_burst_duration_s` | needs key timestamps | **event-only** |
| `mean_burst_length` | needs key timestamps | **event-only** |
| `click_rate` | needs click events | **event-only** |
| `unique_apps` | needs app names per switch | **event-only** |
| `app_category_entropy` | needs app names per switch | **event-only** |

The full feature builder is implemented and tested (`features/build_from_events`).
The gap is in **what the logger persists**, not in the pipeline. Persisting key
timestamps and the switched-to application per epoch is the first SO1 change
needed for the evaluated representation in §3.4.3.

## State discovery (simulated snapshot)

`make states` selects the number of Gaussian-HMM states, decodes every epoch and
writes the transition and context representation:

```
data/processed/state_sequences.csv      per-epoch state, dwell, interruption, recovery
data/processed/c1_representation.csv    model-ready table (features + states + context)
artifacts/states/state_selection.csv    BIC/AIC per state count and seed
artifacts/states/state_profiles.csv     state means, shares and labels
artifacts/states/state_transition_matrix.csv
artifacts/states/state_manifest.json    selected k, rule, stability, labels
```

Current simulated run: **4 states**, selected by the elbow rule (BIC did not
turn inside 2–6), mean seed-stability ARI **0.935** (min 0.837):

| State | Label | Share | Typing/min | Idle | Switches/min |
|---|---|---|---|---|---|
| 0 | Idle / away | 50.0% | 1.2 | 0.95 | 0.12 |
| 1 | Sustained typing | 26.1% | 69.1 | 0.43 | 2.20 |
| 2 | Browsing / light activity | 12.3% | 12.5 | 0.44 | 2.68 |
| 3 | Frequent switching | 11.6% | 3.9 | 0.88 | 2.83 |

The transition matrix shows the expected persistence: Idle/away self-loop
0.978, Sustained typing 0.871, Browsing 0.785, Frequent switching 0.708. These
are exploratory states fitted on all participants; evaluation refits the scaler
and HMM inside each training fold (§3.8).

Interruptions are state-based in screen sessions. In non-screen sessions an idle
state is normal (reading), so only computer use — frequent switching or typing
at 10+ keys/min — counts as an interruption. That gives a 23.9% interruption
rate in screen sessions and 2.9% in non-screen sessions on the simulated data.

## Models and evaluation (simulated snapshot)

```bash
make experiments        # all models, LOPO + LOTO + ablation, ~6–7 min
make quick              # 3 folds, SVM + logistic, for a smoke test
```

Every fold refits the scaler, HMM, state labels and imputation medians on the
training side only. The state count (4) is fixed from Phase 3; HMM parameters
are refit per fold. `make experiments` writes `artifacts/runs/latest/`; running
the script without `--output` creates a timestamped folder instead.

```
summary.csv          mean metrics by split × representation × model
metrics.csv          one row per fold × representation × model
per_participant.csv  LOPO scores used for the paired tests
statistics.csv       paired Wilcoxon, bootstrap CI, Cohen's dz
by_mode.csv          pooled screen vs non-screen metrics
by_task.csv          per held-out task metrics
predictions.csv      every test prediction (audit trail)
run_manifest.json    config, data hashes, git commit/dirty flag, package versions
```

**LOPO Macro-F1 (22 folds, simulated data):**

| Representation | Logistic | Majority | Random Forest | SVM | XGBoost |
|---|---|---|---|---|---|
| Baseline (aggregated) | 0.512 | 0.304 | 0.513 | 0.503 | 0.506 |
| Proposed (states + transitions + context) | **0.524** | 0.304 | 0.496 | **0.519** | 0.502 |

**Ablation (SVM, same folds):**

| Variant | Macro-F1 |
|---|---|
| Proposed | 0.519 |
| No task context | 0.521 |
| No states | 0.489 |
| No transitions | 0.492 |
| Baseline | 0.503 |

**Paired tests across 22 participants (SVM):** proposed − baseline **+0.016**,
95% CI [−0.010, 0.043], Cohen's dz 0.238, Wilcoxon **p = 0.443**. Removing
states costs 0.029 (p = 0.059, dz 0.489); removing transitions costs 0.026
(p = 0.098, dz 0.425). Task context alone is not better (0.521 vs 0.519,
p = 0.526).

**Screen vs non-screen (pooled LOPO predictions, SVM):**

| Study mode | Baseline | Proposed |
|---|---|---|
| Screen | 0.618 | 0.645 |
| Non-screen | 0.380 | **0.499** |

The representation helps where activity counts are weakest — the non-screen
sessions — which is the mechanism the proposal predicted. The overall difference
is still small and not statistically significant at 22 participants; this is a
simulated study, and the real collection is the powered test.

**LOTO caveat:** leave-one-task-out numbers are higher (SVM baseline 0.597,
proposed 0.550; Random Forest 0.576 → 0.604) because the same participants
appear on both sides. It measures task transfer, not participant generalisation.

A curated copy of the run is committed in `artifacts/results/` (summary,
statistics, per-participant scores, manifest). The full run with predictions
stays in the git-ignored `artifacts/runs/full/`.

## Deployable model (Phase 5)

The browser cannot decode the Gaussian HMM, so the app loads a **deployable
subset** trained by this pipeline on the exact live feature contract:

```bash
make export
```

Outputs:

```
../FocusTrack_PP1_Demo/frontend/public/models/c1.json   model weights + metadata
contracts/c1_features.json                              feature order, units, smoothing, threshold
contracts/c1_fixture.json                               golden vector + expected probability
artifacts/export/manifest.json                          data hash, metrics, git state
```

The subset uses the app's ten live inputs (six epoch features, screen mode and
three screen interactions), five-epoch smoothing and learner-normalised probe
labels. LOPO Macro-F1 for this deployable vector: **0.541** (22 participants).
The full HMM representation remains the model reported in the experiments;
moving it into the app needs a backend scoring endpoint or ONNX export.

The app imports the JSON statically (`lib/focus/models.ts`) and falls back to
browser training only if the artifact is missing or malformed. The Python test
`tests/test_export.py` and `npm run verify:c1-model` check the same fixture, so
the two implementations cannot silently drift.

## Status

- [x] Phase 1 — package, configs, frozen simulated snapshot, source loaders
- [x] Phase 2 — full feature builder, canonical schema, probe labels, LOPO/LOTO splits, tests
- [x] Phase 3 — Gaussian HMM states (BIC + stability), transitions, context encoding
- [x] Phase 4 — per-fold pipeline, SVM/RF/XGBoost, ablations, paired Wilcoxon
- [x] Phase 5 — export the fitted model + feature contract to the PP1 app

## Rules

1. Notebooks import `focustrack`; they never define features or models.
2. `data/raw/` is immutable. Everything else is regenerated by `make data`.
3. Every evaluation run writes `artifacts/runs/<run_id>/manifest.json`.
4. Never train on test participants; scalers, HMMs and label normalisers are
   fitted inside each fold (see `docs/DECISIONS.md`).
5. The app consumes an exported artifact; it does not train.
