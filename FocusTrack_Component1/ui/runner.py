"""Background pipeline runs for the demo UI.

A run executes in a worker thread so the API stays responsive; the UI polls
``/api/status`` for stage messages and completion.
"""

from __future__ import annotations

import threading
import time
import traceback
from datetime import datetime, timezone
from typing import Any

from src.database.data_loader import export_raw
from src.pipeline import run_pipeline
from src.simulation import generate_synthetic_tables, save_synthetic_raw
from ui.sources import source_info


class PipelineRunner:
    """Single-flight runner: one pipeline run at a time."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._state: dict[str, Any] = {
            "running": False,
            "source": None,
            "stage": "idle",
            "log": [],
            "started_at": None,
            "finished_at": None,
            "duration_seconds": None,
            "error": None,
        }

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            state = dict(self._state)
            state["log"] = list(state["log"])
            state["threads"] = len([t for t in (self._thread,) if t and t.is_alive()])
            return state

    def start(self, source: str, params: dict[str, Any]) -> dict[str, Any]:
        info = source_info(source)  # raises KeyError for an unknown source
        with self._lock:
            if self._thread and self._thread.is_alive():
                raise RuntimeError("A pipeline run is already in progress.")
            self._state = {
                "running": True,
                "source": source,
                "stage": "starting",
                "log": [f"[{self._now()}] run requested for source '{info['label']}'"],
                "started_at": self._now(),
                "finished_at": None,
                "duration_seconds": None,
                "error": None,
            }
            self._thread = threading.Thread(
                target=self._work, args=(source, dict(params)), daemon=True
            )
            self._thread.start()
        return self.snapshot()

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).strftime("%H:%M:%S")

    def _log(self, message: str) -> None:
        with self._lock:
            self._state["log"].append(f"[{self._now()}] {message}")

    def _stage(self, stage: str, message: str | None = None) -> None:
        with self._lock:
            self._state["stage"] = stage
        if message:
            self._log(message)

    def _work(self, source: str, params: dict[str, Any]) -> None:
        started = time.monotonic()
        info = source_info(source)
        try:
            raw = None
            if info["synthetic"]:
                self._stage(
                    "generating",
                    "Generating synthetic tables "
                    f"({params['participants']} participants x {params['sessions_per_participant']} sessions)",
                )
                raw = generate_synthetic_tables(
                    n_participants=params["participants"],
                    sessions_per_participant=params["sessions_per_participant"],
                    duration_seconds=params["duration_seconds"],
                    seed=params["seed"],
                )
                save_synthetic_raw(raw, info["raw_dir"])
                self._log("Synthetic raw tables written to data/synthetic/raw/")
            elif params.get("export", True):
                self._stage("exporting", "Exporting raw tables from Supabase...")
                written = export_raw()
                self._log(f"Exported {len(written)} tables to data/raw/")
            else:
                self._stage("loading", "Loading raw tables from data/raw/")

            self._stage(
                "pipeline",
                f"Running pipeline (window={params['window_seconds']}s, "
                f"states={params['n_states']}, hidden={params['n_hidden']}, "
                f"ml={'on' if params['run_ml'] else 'off'})",
            )
            bundle = run_pipeline(
                raw,
                window_seconds=params["window_seconds"],
                n_states=params["n_states"],
                n_hidden=params["n_hidden"],
                save=True,
                run_ml=params["run_ml"],
                run_hmm=params["run_hmm"],
                artifacts_root=info["root"],
            )
            counts = bundle["integration_validation"]
            self._log(
                f"Pipeline finished: {len(bundle['features'])} windows, "
                f"{len(bundle['dataset'])} sessions in the model dataset"
            )
            problems = list(counts.get("window", [])) + list(counts.get("session", []))
            self._log(
                "Integration schema validation: "
                + ("OK" if not problems else "; ".join(problems))
            )
            with self._lock:
                self._state["stage"] = "done"
                self._state["error"] = None
        except Exception as exc:  # noqa: BLE001 - surfaced verbatim in the UI
            self._log(f"FAILED: {exc}")
            self._log(traceback.format_exc().strip().splitlines()[-1])
            with self._lock:
                self._state["stage"] = "failed"
                self._state["error"] = str(exc)
        finally:
            duration = round(time.monotonic() - started, 1)
            with self._lock:
                self._state["running"] = False
                self._state["finished_at"] = self._now()
                self._state["duration_seconds"] = duration
            self._log(f"Run complete in {duration}s")
