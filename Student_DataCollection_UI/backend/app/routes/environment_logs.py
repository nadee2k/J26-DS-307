from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from app.config.database import get_db
from app.models.models import EnvironmentLog
from app.schemas.schemas import EnvironmentLogCreate, EnvironmentLogResponse, PaginatedResponse

router = APIRouter()


@router.get("/api/environment", response_model=PaginatedResponse[EnvironmentLogResponse])
async def list_environment_logs(
    sessionId: UUID = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    query = select(EnvironmentLog)
    count_query = select(func.count(EnvironmentLog.id))

    if sessionId:
        query = query.where(EnvironmentLog.session_id == sessionId)
        count_query = count_query.where(EnvironmentLog.session_id == sessionId)

    result = await db.execute(query.order_by(EnvironmentLog.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize))
    logs = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return PaginatedResponse(
        items=[
            EnvironmentLogResponse(
                id=str(log.id),
                sessionId=str(log.session_id),
                temperature=log.temperature,
                humidity=log.humidity,
                light=log.light,
                noise=log.noise,
                motion=log.motion,
                createdAt=log.created_at.isoformat() + "Z"
            ) for log in logs
        ],
        total=total,
        page=page,
        pageSize=pageSize,
        totalPages=(total + pageSize - 1) // pageSize
    )


@router.post("/api/environment", response_model=EnvironmentLogResponse)
async def create_environment_log(log: EnvironmentLogCreate, db: AsyncSession = Depends(get_db)):
    db_log = EnvironmentLog(
        session_id=log.sessionId,
        temperature=log.temperature,
        humidity=log.humidity,
        light=log.light,
        noise=log.noise,
        motion=log.motion
    )
    db.add(db_log)
    await db.flush()
    await db.refresh(db_log)
    return EnvironmentLogResponse(
        id=str(db_log.id),
        sessionId=str(db_log.session_id),
        temperature=db_log.temperature,
        humidity=db_log.humidity,
        light=db_log.light,
        noise=db_log.noise,
        motion=db_log.motion,
        createdAt=db_log.created_at.isoformat() + "Z"
    )


@router.get("/api/environment/latest", response_model=EnvironmentLogResponse)
async def get_latest_environment_log(
    sessionId: UUID = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(EnvironmentLog)
    if sessionId:
        query = query.where(EnvironmentLog.session_id == sessionId)
    query = query.order_by(EnvironmentLog.created_at.desc()).limit(1)

    result = await db.execute(query)
    log = result.scalar_one_or_none()
    if not log:
        return None

    return EnvironmentLogResponse(
        id=str(log.id),
        sessionId=str(log.session_id),
        temperature=log.temperature,
        humidity=log.humidity,
        light=log.light,
        noise=log.noise,
        motion=log.motion,
        createdAt=log.created_at.isoformat() + "Z"
    )
