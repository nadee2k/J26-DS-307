# FocusTrack Component 3 — Computer Vision & Visual Behavior Analysis

Standalone visual pipeline for **FocusTrack** (IT4010, SLIIT): webcam frames in → `visual_focus_score` (0–100) + per-indicator flags + confidence out.

This component is gradeable on its own. Fusion with Components 1/2/4 is a later consumer of the JSON contract in `schema/window_record.schema.json`.

## What it does

1. Samples an external USB webcam at 2–5 fps (default 3 fps, 720p).
2. Detects face presence, head pose, coarse on/off-screen gaze, phone use, and (optionally) expression.
3. Aggregates frame records into 5-second windows with **validity ratios** (missing data is a feature, not a silent gap).
4. Trains a visual-only focus/distraction classifier (Random Forest / XGBoost) with **Leave-N-Participants-Out** cross-validation.
5. Exports the integration contract for the shared Signal Semantics Resolver.

Privacy default: frames are processed in-stream and discarded. Raw video is never written unless `--retain-frames` is set for debugging.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
```

Copy the example consent and label CSVs before a live session:

```bash
cp data/examples/consent_records.csv data/consent/consent_records.csv
cp data/examples/session_labels.csv data/labels/session_labels.csv
```

Capture refuses to start unless the participant ID is marked `consented=true`.

## Camera rig

Use a **standalone USB webcam on a tripod**, not the laptop built-in camera. Non-screen learners (reading/handwriting) may not sit at a laptop; a fixed external rig keeps the field of view identical for both cohorts.

## Commands

```bash
# Live capture (in-stream feature extraction; frames discarded)
python -m component3 capture --participant-id P001 --cohort screen --duration-seconds 60

# 9-point gaze calibration (run once per participant at session start)
python -m component3 calibrate --participant-id P001

# Train baseline RF + XGBoost with LNPO CV
python -m component3 train --features data/processed/features/windows.parquet

# Evaluate (majority-class baseline + mean ± std)
python -m component3 evaluate --features data/processed/features/windows.parquet

# Visual-contribution ablation with mocked Comp 1/2 features
python -m component3 ablation --features data/processed/features/windows.parquet

# Real-time throughput check on this machine
python -m component3 benchmark --n-frames 60

# Fine-tune YOLOv8n on a hand-occlusion-inclusive phone dataset
python -m component3 finetune-phone --data data/phone_dataset/data.yaml

# Smoke-test the ML path with synthetic labelled windows
python -m component3 synthetic --n-participants 20 --out data/processed/features/windows.parquet
```

## Config

All pipeline constants live in [`config/default.yaml`](config/default.yaml). Override with `--config path/to.yaml`.

## Tests

```bash
pytest -q
```

Tests use synthetic frames and records; they do not require a webcam or downloaded YOLO weights.

## Layout

```
.
├── config/
│   └── default.yaml
├── schema/
│   └── window_record.schema.json
├── src/
│   └── component3/          # capture → preprocess → features → windowing → models
├── tests/
├── data/                    # raw/ is gitignored; never commit participant frames
│   ├── calibration/
│   ├── consent/
│   ├── examples/
│   ├── labels/
│   ├── processed/
│   └── raw/
├── reports/
├── notebooks/
├── artifacts/
├── requirements.txt
├── pyproject.toml
└── yolov8n.pt
```

## Evaluation framing

End-to-end accuracy is reported as **mean ± std across LNPO folds**, always beside a **majority-class baseline**. Realistic expectations for this task sit near the DAiSEE band (~55–70% for finer engagement labels); binary focus-vs-distraction should be somewhat easier, but a 90%+ claim is not the design target.

Gaze is **coarse on/off-screen**, not precise gaze-point tracking. Facial expression is the **lowest-confidence, optional** signal and is disabled by default.
