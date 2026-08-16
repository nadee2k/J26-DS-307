"""Background job manager for training/evaluation/benchmark runs."""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class Job:
    id: str
    kind: str
    params: dict[str, Any]
    status: str = "queued"  # queued | running | done | error
    created: float = field(default_factory=time.time)
    started: Optional[float] = None
    finished: Optional[float] = None
    result: Optional[dict[str, Any]] = None
    error: Optional[str] = None

    def to_dict(self, include_result: bool = True) -> dict[str, Any]:
        d = {
            "id": self.id,
            "kind": self.kind,
            "params": self.params,
            "status": self.status,
            "created": self.created,
            "started": self.started,
            "finished": self.finished,
            "error": self.error,
        }
        if include_result:
            d["result"] = self.result
        return d


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def submit(self, kind: str, params: dict[str, Any], fn: Callable[[], dict[str, Any]]) -> Job:
        with self._lock:
            running = [j for j in self._jobs.values() if j.status == "running" and j.kind == kind]
            if running:
                raise RuntimeError(f"A '{kind}' job is already running")
            job = Job(id=uuid.uuid4().hex[:10], kind=kind, params=params)
            self._jobs[job.id] = job

        def _run() -> None:
            job.status = "running"
            job.started = time.time()
            try:
                job.result = fn()
                job.status = "done"
            except Exception as exc:  # surfaced to the UI, not swallowed
                job.error = f"{type(exc).__name__}: {exc}"
                job.status = "error"
                traceback.print_exc()
            finally:
                job.finished = time.time()

        threading.Thread(target=_run, daemon=True, name=f"job-{kind}").start()
        return job

    def get(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def list(self, limit: int = 30) -> list[Job]:
        jobs = sorted(self._jobs.values(), key=lambda j: j.created, reverse=True)
        return jobs[:limit]
