"""FastAPI app serving the Component 1 demo UI.

Run with::

    python -m ui.app --port 8000

then open http://localhost:8000
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from src.config import DEFAULT_N_STATES, DEFAULT_WINDOW_SECONDS, RANDOM_STATE
from src.integration.export import (
    INTEGRATION_SCHEMA_VERSION,
    SESSION_OUTPUT_SCHEMA,
    WINDOW_OUTPUT_SCHEMA,
)
from ui.runner import PipelineRunner
from ui.sources import SOURCES, list_artifacts, overview, read_json, read_table, source_info

STATIC_DIR = Path(__file__).resolve().parent / "static"


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
    runner = PipelineRunner()

    @app.get("/")
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

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

    @app.get("/api/manifest")
    def get_manifest(source: str = Query("real")) -> dict[str, Any]:
        _require_source(source)
        return {"source": source, "artifacts": list_artifacts(source)}

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
