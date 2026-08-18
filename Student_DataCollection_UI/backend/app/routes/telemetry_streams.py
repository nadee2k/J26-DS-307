from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from uuid import UUID

from app.config.database import get_db
from app.models.models import TelemetryStream, TelemetryStreamState
from app.schemas.schemas import TelemetryStreamResponse

router = APIRouter()


@router.get("/api/telemetry-streams", response_model=List[TelemetryStreamResponse])
async def list_telemetry_streams(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TelemetryStream))
    streams = result.scalars().all()
    return [
        TelemetryStreamResponse(
            id=str(s.id),
            label=s.label,
            state=s.state.value
        ) for s in streams
    ]


@router.post("/api/telemetry-streams/{stream_id}/activate", response_model=TelemetryStreamResponse)
async def activate_stream(stream_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TelemetryStream).where(TelemetryStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Telemetry stream not found")

    stream.state = TelemetryStreamState.ACTIVE
    await db.flush()
    await db.refresh(stream)
    return TelemetryStreamResponse(
        id=str(stream.id),
        label=stream.label,
        state=stream.state.value
    )


@router.post("/api/telemetry-streams/{stream_id}/deactivate", response_model=TelemetryStreamResponse)
async def deactivate_stream(stream_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TelemetryStream).where(TelemetryStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Telemetry stream not found")

    stream.state = TelemetryStreamState.INACTIVE
    await db.flush()
    await db.refresh(stream)
    return TelemetryStreamResponse(
        id=str(stream.id),
        label=stream.label,
        state=stream.state.value
    )


@router.post("/api/telemetry-streams/{stream_id}/standby", response_model=TelemetryStreamResponse)
async def standby_stream(stream_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(TelemetryStream).where(TelemetryStream.id == stream_id))
    stream = result.scalar_one_or_none()
    if not stream:
        raise HTTPException(status_code=404, detail="Telemetry stream not found")

    stream.state = TelemetryStreamState.STANDBY
    await db.flush()
    await db.refresh(stream)
    return TelemetryStreamResponse(
        id=str(stream.id),
        label=stream.label,
        state=stream.state.value
    )
