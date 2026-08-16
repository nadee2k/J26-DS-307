"""FastAPI app exposing all Component 3 functionality to the web UI."""

from __future__ import annotations

import csv
import json
import os
import time
from pathlib import Path
from typing import Any, Optional

import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from component3.config import load_config, resolve_path
from component3.export_schema import WINDOW_RECORD_SCHEMA
from component3.web.jobs import JobManager
from component3.web.services import CalibrationService, CaptureController, PreviewService

CFG = load_config(os.environ.get("C3_CONFIG"))
STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="FocusTrack Component 3", docs_url="/api/docs", openapi_url="/api/openapi.json")

jobs = JobManager()
capture = CaptureController()
calibration = CalibrationService()
preview = PreviewService()


def _release_camera_for(activity: str) -> None:
    if preview.running:
        preview.stop()
    if activity != "capture" and capture.running:
        raise HTTPException(409, "A capture session is running; stop it first")
    if activity != "calibration" and calibration.active:
        raise HTTPException(409, "A calibration is in progress; finish or cancel it first")


# ---------------------------------------------------------------- models

class ConsentIn(BaseModel):
    participant_id: str
    consented: bool = True
    notes: str = ""


class LabelIn(BaseModel):
    session_id: str
    participant_id: str = ""
    cohort: str = ""
    focus_rating: float


class CaptureIn(BaseModel):
    participant_id: str
    cohort: str
    source: Optional[str] = None
    duration_seconds: Optional[float] = None
    retain_frames: bool = False
    stub_phone: bool = False


class CalibrationStartIn(BaseModel):
    participant_id: str
    source: Optional[str] = None


class CollectIn(BaseModel):
    step: int


class JobIn(BaseModel):
    kind: str
    params: dict[str, Any] = {}


class PreviewIn(BaseModel):
    source: Optional[str] = None


# ---------------------------------------------------------------- helpers

def _read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _write_csv_rows(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def _session_metas() -> list[dict[str, Any]]:
    features_dir = resolve_path(CFG, "features_dir")
    metas = []
    for meta_path in sorted(features_dir.glob("*_meta.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            meta["captured_at"] = meta_path.stat().st_mtime
            metas.append(meta)
        except Exception:
            continue
    return metas


def _df_records(df: pd.DataFrame) -> list[dict[str, Any]]:
    return json.loads(df.to_json(orient="records"))


REPORT_FILES = ["baseline_cv.json", "evaluation.json", "ablation.json", "benchmark.json", "cnn_train.json"]


def _reports() -> dict[str, Any]:
    reports_dir = resolve_path(CFG, "reports_dir")
    out: dict[str, Any] = {}
    for name in REPORT_FILES:
        p = reports_dir / name
        if p.exists():
            try:
                out[name.replace(".json", "")] = {
                    "mtime": p.stat().st_mtime,
                    "data": json.loads(p.read_text(encoding="utf-8")),
                }
            except Exception:
                continue
    return out


# ---------------------------------------------------------------- overview & config

@app.get("/api/overview")
def overview() -> dict[str, Any]:
    consent_rows = _read_csv_rows(resolve_path(CFG, "consent_file"))
    consented = [r for r in consent_rows if (r.get("consented") or "").lower() in {"true", "1", "yes", "y"}]
    labels = _read_csv_rows(resolve_path(CFG, "labels_file"))
    metas = _session_metas()
    cal_dir = resolve_path(CFG, "calibration_dir")
    calibrations = sorted(p.stem for p in cal_dir.glob("*.joblib")) if cal_dir.exists() else []
    reports = _reports()
    train_summary = None
    if "baseline_cv" in reports:
        models = reports["baseline_cv"]["data"].get("models", [])
        if models:
            best = max(models, key=lambda m: m.get("f1_mean") or 0)
            train_summary = {
                "model": best.get("model"),
                "accuracy_mean": best.get("accuracy_mean"),
                "accuracy_std": best.get("accuracy_std"),
                "f1_mean": best.get("f1_mean"),
                "f1_std": best.get("f1_std"),
                "majority_baseline_accuracy_mean": best.get("majority_baseline_accuracy_mean"),
            }
    bench = reports.get("benchmark", {}).get("data")
    return {
        "participants_consented": len(consented),
        "sessions": len(metas),
        "windows_total": sum(int(m.get("n_windows") or 0) for m in metas),
        "labels": len(labels),
        "calibrations": calibrations,
        "recent_sessions": metas[:5],
        "train_summary": train_summary,
        "benchmark": {
            "max_sustainable_fps": bench.get("max_sustainable_fps"),
            "target_fps": bench.get("target_fps"),
            "meets_target": bench.get("meets_target"),
            "stub_phone": bench.get("stub_phone"),
        }
        if bench
        else None,
        "capture_running": capture.running,
        "calibration_active": calibration.active,
    }


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    return {k: v for k, v in CFG.items() if not str(k).startswith("_")}


@app.get("/api/schema")
def get_schema() -> dict[str, Any]:
    return WINDOW_RECORD_SCHEMA


# ---------------------------------------------------------------- consent & labels

@app.get("/api/consent")
def list_consent() -> list[dict[str, str]]:
    return _read_csv_rows(resolve_path(CFG, "consent_file"))


@app.post("/api/consent")
def add_consent(body: ConsentIn) -> list[dict[str, str]]:
    path = resolve_path(CFG, "consent_file")
    rows = _read_csv_rows(path)
    pid = body.participant_id.strip()
    if not pid:
        raise HTTPException(400, "participant_id is required")
    updated = False
    for row in rows:
        if row.get("participant_id") == pid:
            row["consented"] = str(body.consented).lower()
            row["notes"] = body.notes
            updated = True
    if not updated:
        rows.append(
            {
                "participant_id": pid,
                "consented": str(body.consented).lower(),
                "consent_date": time.strftime("%Y-%m-%d"),
                "notes": body.notes,
            }
        )
    _write_csv_rows(path, rows, ["participant_id", "consented", "consent_date", "notes"])
    return rows


@app.get("/api/labels")
def list_labels() -> list[dict[str, str]]:
    return _read_csv_rows(resolve_path(CFG, "labels_file"))


@app.post("/api/labels")
def upsert_label(body: LabelIn) -> list[dict[str, str]]:
    path = resolve_path(CFG, "labels_file")
    rows = _read_csv_rows(path)
    updated = False
    for row in rows:
        if row.get("session_id") == body.session_id:
            row["focus_rating"] = str(body.focus_rating)
            if body.participant_id:
                row["participant_id"] = body.participant_id
            if body.cohort:
                row["cohort"] = body.cohort
            updated = True
    if not updated:
        rows.append(
            {
                "session_id": body.session_id,
                "participant_id": body.participant_id,
                "cohort": body.cohort,
                "focus_rating": str(body.focus_rating),
                "notes": "",
            }
        )
    _write_csv_rows(path, rows, ["session_id", "participant_id", "cohort", "focus_rating", "notes"])
    return rows


# ---------------------------------------------------------------- sessions

@app.get("/api/sessions")
def list_sessions() -> list[dict[str, Any]]:
    labels = {r.get("session_id"): r for r in _read_csv_rows(resolve_path(CFG, "labels_file"))}
    metas = _session_metas()
    for m in metas:
        lab = labels.get(m.get("session_id"))
        m["focus_rating"] = lab.get("focus_rating") if lab else None
    return metas


@app.get("/api/sessions/{session_id}/windows")
def session_windows(session_id: str) -> list[dict[str, Any]]:
    path = resolve_path(CFG, "features_dir") / f"{session_id}_windows.parquet"
    if not path.exists():
        raise HTTPException(404, "Session windows not found")
    return _df_records(pd.read_parquet(path))


@app.get("/api/sessions/{session_id}/download/{artifact}")
def session_download(session_id: str, artifact: str) -> FileResponse:
    features_dir = resolve_path(CFG, "features_dir")
    mapping = {
        "contract": (features_dir / f"{session_id}_contract.jsonl", "application/jsonl"),
        "frames": (features_dir / f"{session_id}_frames.csv", "text/csv"),
        "windows": (features_dir / f"{session_id}_windows.parquet", "application/octet-stream"),
    }
    if artifact not in mapping:
        raise HTTPException(404, "Unknown artifact")
    path, media = mapping[artifact]
    if not path.exists():
        raise HTTPException(404, "Artifact not found")
    return FileResponse(path, media_type=media, filename=path.name)


@app.get("/api/features")
def list_feature_files() -> list[dict[str, Any]]:
    features_dir = resolve_path(CFG, "features_dir")
    out = []
    for p in sorted(features_dir.glob("*.parquet"), key=lambda p: p.stat().st_mtime, reverse=True):
        out.append({"name": p.name, "mtime": p.stat().st_mtime, "size": p.stat().st_size})
    return out


# ---------------------------------------------------------------- preview

@app.post("/api/preview/start")
def preview_start(body: PreviewIn) -> dict[str, Any]:
    if capture.running or calibration.active:
        raise HTTPException(409, "Camera is in use by capture/calibration")
    preview.start(
        body.source if body.source is not None else CFG["capture"]["device_index"],
        CFG["capture"]["width"],
        CFG["capture"]["height"],
    )
    return {"running": preview.running, "error": preview.error}


@app.post("/api/preview/stop")
def preview_stop() -> dict[str, Any]:
    preview.stop()
    return {"running": preview.running}


@app.get("/api/preview/frame.jpg")
def preview_frame() -> Response:
    data = preview.frame()
    if not data:
        raise HTTPException(404, preview.error or "No preview frame yet")
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- capture

@app.post("/api/capture/start")
def capture_start(body: CaptureIn) -> dict[str, Any]:
    _release_camera_for("capture")
    try:
        return capture.start(CFG, body.model_dump())
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@app.post("/api/capture/stop")
def capture_stop() -> dict[str, Any]:
    return capture.stop()


@app.get("/api/capture/status")
def capture_status() -> dict[str, Any]:
    return capture.status()


@app.get("/api/capture/preview.jpg")
def capture_preview() -> Response:
    if not capture.preview_jpeg:
        raise HTTPException(404, "No frame yet")
    return Response(content=capture.preview_jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- calibration

@app.get("/api/calibrations")
def list_calibrations() -> list[dict[str, Any]]:
    cal_dir = resolve_path(CFG, "calibration_dir")
    out = []
    if cal_dir.exists():
        for p in sorted(cal_dir.glob("*.joblib")):
            out.append({"participant_id": p.stem, "mtime": p.stat().st_mtime})
    return out


@app.delete("/api/calibrations/{participant_id}")
def delete_calibration(participant_id: str) -> dict[str, Any]:
    path = resolve_path(CFG, "calibration_dir") / f"{participant_id}.joblib"
    if not path.exists():
        raise HTTPException(404, "No calibration for that participant")
    path.unlink()
    return {"deleted": participant_id}


@app.post("/api/calibration/start")
def calibration_start(body: CalibrationStartIn) -> dict[str, Any]:
    _release_camera_for("calibration")
    try:
        return calibration.start(CFG, body.participant_id, body.source)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))


@app.post("/api/calibration/collect")
def calibration_collect(body: CollectIn) -> dict[str, Any]:
    try:
        return calibration.collect(body.step)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/calibration/finish")
def calibration_finish() -> dict[str, Any]:
    try:
        return calibration.finish()
    except RuntimeError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/calibration/cancel")
def calibration_cancel() -> dict[str, Any]:
    calibration.cancel()
    return {"active": calibration.active}


@app.get("/api/calibration/status")
def calibration_status() -> dict[str, Any]:
    return calibration.status()


@app.get("/api/calibration/preview.jpg")
def calibration_preview() -> Response:
    if not calibration.preview_jpeg:
        raise HTTPException(404, "No frame yet")
    return Response(content=calibration.preview_jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# ---------------------------------------------------------------- jobs & reports

def _job_fn(kind: str, params: dict[str, Any]):
    features_dir = resolve_path(CFG, "features_dir")

    def _features_path() -> Optional[Path]:
        name = params.get("features")
        return features_dir / name if name else None

    if kind == "train":
        from component3.models.train_baseline import train_and_save

        return lambda: train_and_save(CFG, features_path=_features_path())
    if kind == "evaluate":
        from component3.evaluate import evaluate

        return lambda: evaluate(CFG, features_path=_features_path())
    if kind == "ablation":
        from component3.ablation import run_ablation

        return lambda: run_ablation(CFG, features_path=_features_path())
    if kind == "benchmark":
        from component3.benchmark import run_benchmark

        return lambda: run_benchmark(
            CFG,
            n_frames=int(params.get("n_frames", 30)),
            stub_phone=not bool(params.get("load_yolo", False)),
            use_camera=bool(params.get("use_camera", False)),
        )
    if kind == "synthetic":
        from component3.synthetic import write_synthetic

        return lambda: write_synthetic(CFG, int(params.get("n_participants", 20)))
    raise HTTPException(400, f"Unknown job kind: {kind}")


@app.post("/api/jobs")
def submit_job(body: JobIn) -> dict[str, Any]:
    if body.kind == "benchmark" and bool(body.params.get("use_camera")) and (capture.running or calibration.active):
        raise HTTPException(409, "Camera is in use")
    fn = _job_fn(body.kind, body.params)
    try:
        job = jobs.submit(body.kind, body.params, fn)
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return job.to_dict(include_result=False)


@app.get("/api/jobs")
def list_jobs() -> list[dict[str, Any]]:
    return [j.to_dict(include_result=False) for j in jobs.list()]


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found")
    return job.to_dict()


@app.get("/api/reports")
def get_reports() -> dict[str, Any]:
    return _reports()


# ---------------------------------------------------------------- static SPA

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
else:  # pragma: no cover

    @app.get("/", response_class=HTMLResponse)
    def _no_static() -> str:
        return "<h1>Static assets missing</h1>"


def main(argv: list[str] | None = None) -> int:
    import argparse

    import uvicorn

    parser = argparse.ArgumentParser(description="FocusTrack Component 3 web app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8300)
    args = parser.parse_args(argv)
    print(f"FocusTrack Component 3 → http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
