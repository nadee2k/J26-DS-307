from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from contextlib import asynccontextmanager

from app.config.database import init_db, get_db
from app.models.models import EnvironmentLog, BehaviorLog, VisionLog
from app.routes import students, sessions, concentration_logs, telemetry_streams, environment_logs, behavior_logs, vision_logs


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="FocusTrack Data Collection API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(students.router)
app.include_router(sessions.router)
app.include_router(concentration_logs.router)
app.include_router(telemetry_streams.router)
app.include_router(environment_logs.router)
app.include_router(behavior_logs.router)
app.include_router(vision_logs.router)


@app.get("/")
async def root():
    return {"message": "FocusTrack Data Collection API"}


ACTIVE_THRESHOLD_SECONDS = 5


async def _check_latest(session_id: UUID, model, db: AsyncSession) -> dict:
    result = await db.execute(
        select(model).where(model.session_id == session_id).order_by(model.created_at.desc()).limit(1)
    )
    log = result.scalar_one_or_none()
    if not log:
        return {"active": False, "lastSeen": None, "count": 0}

    count_result = await db.execute(
        select(model).where(model.session_id == session_id)
    )
    total = len(count_result.scalars().all())
    now = datetime.now(timezone.utc)
    last = log.created_at.replace(tzinfo=timezone.utc) if log.created_at.tzinfo is None else log.created_at
    diff = (now - last).total_seconds()

    return {
        "active": diff < ACTIVE_THRESHOLD_SECONDS,
        "lastSeen": last.isoformat(),
        "count": total,
    }


@app.get("/api/status/{session_id}")
async def get_data_source_status(session_id: UUID, db: AsyncSession = Depends(get_db)):
    env = await _check_latest(session_id, EnvironmentLog, db)
    beh = await _check_latest(session_id, BehaviorLog, db)
    vis = await _check_latest(session_id, VisionLog, db)
    return {
        "environment": env,
        "behavior": beh,
        "vision": vis,
    }
