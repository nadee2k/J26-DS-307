# Notebooks

Exploration and figures only. Any function used twice moves to
`src/focustrack/`; notebooks import it.

| Notebook | Purpose | Artifact |
|---|---|---|
| `01_eda.ipynb` | study shape, probes, observer coverage, missingness | — |
| `02_feature_engineering.ipynb` | canonical features, by-mode distributions, full event-level example | `features.csv` (from `make data`) |
| `03_interaction_states.ipynb` | BIC curve, stability, state profiles, transition matrix, one session timeline | `state_profiles.csv`, Figure 9 |
| `04_models.ipynb` | LOPO, LOTO, ablation, paired statistics, screen vs non-screen | `summary.csv`, `statistics.csv` |
| `03_hmm_states.ipynb` *(planned)* | BIC curve, seed stability, state profiles | `state_profiles.csv`, Figure 9 |
| `04_models.ipynb` *(planned)* | baseline vs proposed × SVM/RF/XGB | `experiment_summary.csv` |
| `05_ablation_loto.ipynb` *(planned)* | ablation ladder + leave-one-task-out | Figure 6 tables |
| `06_errors_non_screen.ipynb` *(planned)* | per-participant errors, interruption detection | error tables |

Run and export HTML:

```bash
make notebooks
```
