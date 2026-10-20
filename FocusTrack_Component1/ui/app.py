"""FastAPI app serving the Component 1 demo UI.

Run with::

    python -m ui.app --port 8000

then open http://localhost:8000
"""

from __future__ import annotations

import argparse
import io
from pathlib import Path
from typing import Any

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.config import DEFAULT_N_STATES, DEFAULT_WINDOW_SECONDS, RANDOM_STATE
from src.integration.export import (
    INTEGRATION_SCHEMA_VERSION,
    SESSION_OUTPUT_SCHEMA,
    WINDOW_OUTPUT_SCHEMA,
)
from ui import focus, live, session_infer
from ui.runner import PipelineRunner
from ui.sources import (
    SOURCES,
    learning_type_analysis,
    list_artifacts,
    overview,
    read_json,
    read_table,
    source_info,
)

STATIC_DIR = Path(__file__).resolve().parent / "static"


class LiveSnapshotModel(BaseModel):
    created_at: str
    keyboard_count: int = 0
    mouse_distance: float = 0.0
    mouse_clicks: int = 0
    idle_time: float = 0.0
    active_application: str | None = None


class LivePushRequest(BaseModel):
    source: str = "real"
    participant_id: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    context: str = ""
    context_code: int | None = None
    window_seconds: int | None = Field(default=None, ge=15, le=600)
    snapshots: list[LiveSnapshotModel] = Field(default_factory=list, max_length=live.MAX_PUSH_ROWS)


class RunRequest(BaseModel):
    source: str = "real"
    window_seconds: int = Field(default=DEFAULT_WINDOW_SECONDS, ge=15, le=600)
    n_states: int = Field(default=DEFAULT_N_STATES, ge=2, le=8)
    n_hidden: int = Field(default=3, ge=2, le=6)
    run_ml: bool = True
    run_hmm: bool = True
    export: bool = True
    # synthetic-source knobs
    participants: int = Field(default=15, ge=2, le=60)
    sessions_per_participant: int = Field(default=3, ge=1, le=10)
    duration_seconds: int = Field(default=600, ge=120, le=3600)
    seed: int = RANDOM_STATE


def _require_source(source: str) -> dict[str, Any]:
    try:
        return source_info(source)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def create_app() -> FastAPI:
    app = FastAPI(title="FocusTrack Component 1", version=INTEGRATION_SCHEMA_VERSION)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3001",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    runner = PipelineRunner()

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/health")
    def health() -> dict[str, Any]:
        """Liveness probe — polled by local tooling while the UI runs."""
        status = runner.snapshot()
        return {
            "status": "running" if status["running"] else "idle",
            "stage": status["stage"],
            "sources": list(SOURCES),
        }

    @app.get("/api/sources")
    def sources() -> list[dict[str, Any]]:
        out = []
        for name in SOURCES:
            info = source_info(name)
            artefacts = list_artifacts(name)
            out.append(
                {
                    **info,
                    "root": str(info["root"]) if info["root"] else "data/",
                    "artifacts": len([a for a in artefacts if a["exists"]]),
                    "ready": any(a["exists"] for a in artefacts),
                }
            )
        return out

    @app.get("/api/schema")
    def schema() -> dict[str, Any]:
        return {
            "integration_version": INTEGRATION_SCHEMA_VERSION,
            "window": list(WINDOW_OUTPUT_SCHEMA),
            "session": list(SESSION_OUTPUT_SCHEMA),
        }

    @app.get("/api/overview")
    def get_overview(source: str = Query("real")) -> dict[str, Any]:
        _require_source(source)
        return overview(source)

    @app.get("/focus")
    def focus_page() -> FileResponse:
        """Standalone Component 1 dashboard: focus trends across past sessions."""
        return FileResponse(STATIC_DIR / "focus.html")

    @app.get("/session-demo")
    def session_demo_page() -> FileResponse:
        """Simple student-facing start/end session demo for Component 1."""
        return FileResponse(STATIC_DIR / "session-demo.html")

    @app.get("/api/focus")
    def get_focus(source: str = Query("real")) -> dict[str, Any]:
        _require_source(source)
        return focus.build(source)

    @app.get("/api/manifest")
    def get_manifest(source: str = Query("real")) -> dict[str, Any]:
        _require_source(source)
        return {"source": source, "artifacts": list_artifacts(source)}

    @app.get("/api/analysis/learning-type")
    def get_learning_type(source: str = Query("real")) -> dict[str, Any]:
        """Screen vs non-screen participants, decided from behaviour alone."""
        _require_source(source)
        return learning_type_analysis(source)

    @app.get("/api/tables/{name}")
    def get_table(
        name: str,
        source: str = Query("real"),
        limit: int = Query(200, ge=1, le=5000),
        offset: int = Query(0, ge=0),
    ) -> dict[str, Any]:
        _require_source(source)
        try:
            return read_table(source, name, limit=limit, offset=offset)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/json/{name}")
    def get_json(name: str, source: str = Query("real")) -> dict[str, Any]:
        _require_source(source)
        try:
            return read_json(source, name)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/labelling/rules")
    def labelling_rules() -> dict[str, Any]:
        return {
            "method": "Aggregate self-reported concentration ratings per session",
            "target_source": "concentration_logs.level (1–5)",
            "aggregation": "Mean of all ratings in the session",
            "rounding": "concentration_label = floor(concentration_mean + 0.5).clip(1, 5)",
            "rounding_note": "Half-up rounding (e.g. mean 4.5 -> 5, mean 3.5 -> 4)",
            "binary_threshold": 3.5,
            "binary_rule": "concentration_binary = (concentration_mean >= 3.5)",
            "uses_self_reports": True,
            "states_unsupervised": True,
            "states_from": "Behavioural features only (keyboard/mouse/app/temporal) via unsupervised clustering (KMeans/GMM)",
            "labels_used_for": [
                "Supervised evaluation (baseline vs proposed vs ablations)",
                "Context-effect descriptive summaries",
                "Leave-one-participant-out generalisation checks",
            ],
            "not_used_for": [
                "Discovering interaction states",
                "Computing state transitions/run-lengths",
                "Window feature extraction",
            ],
        }

    @app.get("/api/labelling/overview")
    def labelling_overview(source: str = Query("real"), limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
        _require_source(source)
        dataset = read_table(source, "session_dataset", limit=limit)
        manifest = read_json(source, "run_manifest")
        conc_raw = read_table(source, "concentration_logs", limit=20) if False else None  # placeholder
        try:
            conc = read_table(source, "concentration_logs", limit=10)
        except Exception:
            conc = {"exists": False, "rows": []}

        dist = []
        if dataset["exists"] and dataset["rows"]:
            import pandas as pd

            df = pd.DataFrame(dataset["rows"])
            if "concentration_label" in df.columns:
                vc = df["concentration_label"].value_counts().sort_index()
                for k, v in vc.items():
                    dist.append({"label": int(k), "count": int(v)})
            elif "concentration_mean" in df.columns:
                df["lbl"] = (df["concentration_mean"] + 0.5).apply(lambda x: int(__import__("math").floor(x))).clip(1, 5)
                vc = df["lbl"].value_counts().sort_index()
                for k, v in vc.items():
                    dist.append({"label": int(k), "count": int(v)})

        return {
            "source": source,
            "dataset": dataset,
            "concentration_sample": conc,
            "label_distribution": dist,
            "manifest": manifest,
        }

    @app.get("/api/status")
    def status() -> dict[str, Any]:
        return runner.snapshot()

    @app.post("/api/run")
    def run(request: RunRequest) -> dict[str, Any]:
        _require_source(request.source)
        params = request.model_dump()
        try:
            return runner.start(request.source, params)
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    # ------------------------------------------------------------------
    # Single-session analyzer
    # ------------------------------------------------------------------

    @app.get("/api/session/analyze/ready")
    def session_ready(source: str = Query("real")) -> dict[str, Any]:
        """Whether this source has trained state artefacts to infer with."""
        _require_source(source)
        return session_infer.ready(source)

    @app.get("/api/session/sample")
    def session_sample(source: str = Query("")) -> Response:
        """A minimal events CSV so users know which columns to export."""
        csv_text, filename, origin = session_infer.sample_events(source or None)
        return Response(
            content=csv_text,
            media_type="text/csv",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Sample-Origin": origin,
            },
        )

    @app.post("/api/session/analyze")
    async def session_analyze(
        file: UploadFile = File(...),
        source: str = Form("real"),
        participant_id: str = Form(""),
        session_id: str = Form(""),
        context: str = Form(""),
        context_code: str = Form(""),
        window_seconds: int = Form(DEFAULT_WINDOW_SECONDS),
    ) -> dict[str, Any]:
        _require_source(source)

        state = session_infer.ready(source)
        if not state["ready"]:
            raise HTTPException(status_code=409, detail=state["message"])

        payload = await file.read()
        if len(payload) > session_infer.MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Upload larger than {session_infer.MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            )
        if not payload:
            raise HTTPException(status_code=400, detail="The uploaded file is empty.")

        try:
            frame = pd.read_csv(io.BytesIO(payload))
        except Exception as exc:  # noqa: BLE001 - surfaced verbatim in the UI
            raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}") from exc

        code: int | None = None
        if context_code.strip():
            try:
                code = int(context_code.strip())
            except ValueError as exc:
                raise HTTPException(
                    status_code=400, detail="context_code must be an integer."
                ) from exc

        # If the file has no session_id column, the file name stands in as id.
        session_hint = Path(file.filename or "session").stem

        try:
            return session_infer.analyze(
                frame,
                source=source,
                participant_id=participant_id.strip() or None,
                session_id=session_id.strip() or None,
                session_hint=session_hint or None,
                context=context.strip() or None,
                context_code=code,
                window_seconds=window_seconds,
            )
        except session_infer.ModelNotReadyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except session_infer.SessionAnalysisError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/session/download/{kind}")
    def session_download(kind: str, key: str = Query(...)) -> FileResponse:
        path = session_infer.download_path(key, kind)
        if path is None:
            raise HTTPException(status_code=404, detail="Download not found or expired.")
        return FileResponse(path, media_type="text/csv", filename=path.name)

    # ------------------------------------------------------------------
    # Live student dashboard (polled by Student_DataCollection_UI)
    # ------------------------------------------------------------------

    @app.get("/api/live/ready")
    def live_ready(source: str = Query("real")) -> dict[str, Any]:
        """Whether a source can serve live readouts (state model + HMM)."""
        _require_source(source)
        return live.ready(source)

    @app.post("/api/live/push")
    def live_push(request: LivePushRequest) -> dict[str, Any]:
        """Append snapshots to a session's buffer and return a fresh readout."""
        _require_source(request.source)
        try:
            return live.push(request.model_dump())
        except session_infer.ModelNotReadyError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except session_infer.SessionAnalysisError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/api/live/state")
    def live_state(session_id: str = Query(..., min_length=1)) -> dict[str, Any]:
        """The last readout of a session without pushing anything."""
        payload = live.session_state(session_id)
        if payload is None:
            raise HTTPException(status_code=404, detail="No live buffer for this session.")
        return payload

    @app.delete("/api/live/session")
    def live_clear(session_id: str = Query(..., min_length=1)) -> dict[str, Any]:
        return live.clear_session(session_id)

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    return app


app = create_app()


def main() -> None:
    parser = argparse.ArgumentParser(description="FocusTrack Component 1 demo UI")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(
        "ui.app:app", host=args.host, port=args.port, reload=args.reload
    )


if __name__ == "__main__":
    main()
