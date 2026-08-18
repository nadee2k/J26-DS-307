from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List
from uuid import UUID

from app.config.database import get_db
from app.models.models import ConcentrationLog, Environment
from app.schemas.schemas import ConcentrationLogCreate, ConcentrationLogResponse, PaginatedResponse
from datetime import datetime

router = APIRouter()


@router.get("/api/concentration-logs", response_model=List[ConcentrationLogResponse])
async def list_concentration_logs(
    sessionId: UUID = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    query = select(ConcentrationLog)

    if sessionId:
        query = query.where(ConcentrationLog.session_id == sessionId)
        result = await db.execute(query)
        logs = result.scalars().all()
        return [
            ConcentrationLogResponse(
                id=str(log.id),
                sessionId=str(log.session_id),
                level=log.level,
                environment=log.environment.value,
                notes=log.notes,
                recordedAt=log.recorded_at.isoformat() + "Z"
            ) for log in logs
        ]
    else:
        count_query = select(func.count(ConcentrationLog.id))
        result = await db.execute(query.offset((page - 1) * pageSize).limit(pageSize))
        logs = result.scalars().all()

        count_result = await db.execute(count_query)
        total = count_result.scalar()

        return [
            ConcentrationLogResponse(
                id=str(log.id),
                sessionId=str(log.session_id),
                level=log.level,
                environment=log.environment.value,
                notes=log.notes,
                recordedAt=log.recorded_at.isoformat() + "Z"
            ) for log in logs
        ]


@router.post("/api/concentration-logs", response_model=ConcentrationLogResponse)
async def create_concentration_log(log: ConcentrationLogCreate, db: AsyncSession = Depends(get_db)):
    from app.models.models import Environment
    db_log = ConcentrationLog(
        session_id=log.sessionId,
        level=log.level,
        environment=Environment(log.environment),
        notes=log.notes
    )
    db.add(db_log)
    await db.flush()
    await db.refresh(db_log)
    return ConcentrationLogResponse(
        id=str(db_log.id),
        sessionId=str(db_log.session_id),
        level=db_log.level,
        environment=db_log.environment.value,
        notes=db_log.notes,
        recordedAt=db_log.recorded_at.isoformat() + "Z"
    )
