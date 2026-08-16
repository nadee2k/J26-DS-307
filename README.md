# FocusTrack Component 3 — Computer Vision & Visual Behavior Analysis

**Research Project**: J26-DS-307  
**Course**: IT4010 - Research Project  
**Institution**: Sri Lanka Institute of Information Technology (SLIIT)  
**Academic Year**: 2026

## Overview

FocusTrack Component 3 is a standalone computer vision pipeline that analyzes visual behavior indicators to detect student focus and distraction during learning sessions. The system processes webcam frames in real-time to produce a `visual_focus_score` (0–100) along with per-indicator flags and confidence metrics.

This component is designed to be independently gradeable and testable. Integration with Components 1/2/4 is achieved through the JSON contract defined in `schema/window_record.schema.json`.

### Key Features

- **Real-time Visual Analysis**: Processes webcam feeds at 2-5 fps (default 3 fps)
- **Multi-Modal Detection**: Face presence, head pose, gaze tracking, phone detection, and facial expressions
- **Privacy-First Design**: Frames processed in-stream and discarded by default (no video storage)
- **Machine Learning Pipeline**: Random Forest and XGBoost classifiers with Leave-N-Participants-Out cross-validation
- **Web Management Interface**: Complete FastAPI-based web app for data collection and monitoring
- **Consent Management**: Built-in consent tracking system for ethical data collection

## How It Works

1. **Video Capture**: Samples an external USB webcam at 2–5 fps (default 3 fps, 720p resolution)
2. **Feature Extraction**: Detects and analyzes:
   - Face presence and quality (blur, occlusion, glare)
   - Head pose (pitch, yaw, roll angles)
   - Coarse on/off-screen gaze estimation
   - Phone usage detection (YOLOv8n-based)
   - Facial expressions (optional, disabled by default)
3. **Temporal Aggregation**: Groups frame records into 5-second windows with validity ratios
4. **ML Classification**: Trains visual focus/distraction classifiers using Random Forest and XGBoost
5. **Evaluation**: Provides Leave-N-Participants-Out cross-validation with baseline comparisons
6. **Schema Export**: Generates integration contracts for the Signal Semantics Resolver

### Performance Metrics

Based on synthetic data evaluation (1920 windows, 20 participants):
- **Random Forest**: 97.0% ± 1.2% accuracy (baseline: 55.0% ± 6.1%)
- **XGBoost**: 97.0% ± 1.4% accuracy
- **F1 Score**: 0.973 ± 0.010 (both models)

*Note: Real-world performance may vary. Realistic expectations align with DAiSEE benchmarks (55-70% for finer engagement labels).*

## Quick Start

### Web Interface (Recommended)

The easiest way to use Component 3 is through the web management interface:

```bash
python -m component3 web
```

Then open http://127.0.0.1:8300 in your browser.

The web interface provides:
- Live camera preview and calibration
- Participant consent management
- Session capture with real-time monitoring
- Label annotation interface
- Model training and evaluation dashboards
- Report visualization (accuracy, ablation studies, benchmarks)

### Command Line

All functionality is also available via CLI commands (see Commands section below).

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

## Technology Stack

- **Computer Vision**: OpenCV, MediaPipe, Ultralytics YOLOv8
- **Machine Learning**: scikit-learn, XGBoost, PyTorch
- **Web Framework**: FastAPI, Uvicorn
- **Data Processing**: pandas, NumPy, PyArrow (Parquet)
- **Testing**: pytest
- **Python**: 3.10+ (developed on 3.12)

## Project Structure

This repository contains:
- `src/component3/`: Core pipeline modules
  - `capture.py`: Webcam capture and session management
  - `preprocess.py`: Frame preprocessing and quality checks
  - `features/`: Feature extraction modules (gaze, pose, phone, expression)
  - `models/`: ML training and inference
  - `web/`: FastAPI application and web interface
- `config/`: Configuration files (pipeline parameters)
- `schema/`: JSON schema for integration contracts
- `data/`: Data directories (raw, processed, labels, consent)
- `reports/`: Generated evaluation reports and metrics
- `tests/`: Unit and integration tests
- `notebooks/`: Exploratory data analysis

## Repository

**GitHub**: [https://github.com/nadee2k/J26-DS-307](https://github.com/nadee2k/J26-DS-307)  
**Branch**: `component-3`

## License

This is an academic research project developed for IT4010 at SLIIT. All rights reserved to the project team and institution.

## Privacy & Ethics

- **Consent-gated**: System refuses to start capture without explicit participant consent
- **Privacy-first**: Frames processed in-stream, no video storage by default
- **Anonymized data**: Participant IDs used instead of personal information
- **Transparent**: All detection methods and confidence scores are reported
- **Optional retention**: `--retain-frames` flag only for debugging purposes
