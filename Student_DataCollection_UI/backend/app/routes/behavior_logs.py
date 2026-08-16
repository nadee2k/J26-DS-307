from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from app.config.database import get_db
from app.models.models import BehaviorLog
from app.schemas.schemas import BehaviorLogCreate, BehaviorLogResponse, PaginatedResponse

router = APIRouter()


@router.get("/api/behavior", response_model=PaginatedResponse[BehaviorLogResponse])
async def list_behavior_logs(
    sessionId: UUID = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    query = select(BehaviorLog)
    count_query = select(func.count(BehaviorLog.id))

    if sessionId:
        query = query.where(BehaviorLog.session_id == sessionId)
        count_query = count_query.where(BehaviorLog.session_id == sessionId)

    result = await db.execute(query.order_by(BehaviorLog.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize))
    logs = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return PaginatedResponse(
        items=[
            BehaviorLogResponse(
                id=str(log.id),
                sessionId=str(log.session_id),
                keyboardCount=log.keyboard_count,
                mouseMovement=log.mouse_distance,
                mouseClicks=log.mouse_clicks,
                idleTime=log.idle_time,
                activeApplication=log.active_application,
                createdAt=log.created_at.isoformat() + "Z"
            ) for log in logs
        ],
        total=total,
        page=page,
        pageSize=pageSize,
        totalPages=(total + pageSize - 1) // pageSize
    )


@router.post("/api/behavior", response_model=BehaviorLogResponse)
async def create_behavior_log(log: BehaviorLogCreate, db: AsyncSession = Depends(get_db)):
    db_log = BehaviorLog(
        session_id=log.sessionId,
        keyboard_count=log.keyboardCount or 0,
        mouse_distance=log.mouseMovement or 0.0,
        mouse_clicks=log.mouseClicks or 0,
        idle_time=log.idleTime or 0.0,
        active_application=log.activeApplication,
    )
    db.add(db_log)
    await db.flush()
    await db.refresh(db_log)
    return BehaviorLogResponse(
        id=str(db_log.id),
        sessionId=str(db_log.session_id),
        keyboardCount=db_log.keyboard_count,
        mouseMovement=db_log.mouse_distance,
        mouseClicks=db_log.mouse_clicks,
        idleTime=db_log.idle_time,
        activeApplication=db_log.active_application,
        createdAt=db_log.created_at.isoformat() + "Z"
    )


@router.get("/api/behavior/latest", response_model=BehaviorLogResponse)
async def get_latest_behavior_log(
    sessionId: UUID = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(BehaviorLog)
    if sessionId:
        query = query.where(BehaviorLog.session_id == sessionId)
    query = query.order_by(BehaviorLog.created_at.desc()).limit(1)

    result = await db.execute(query)
    log = result.scalar_one_or_none()
    if not log:
        return None

    return BehaviorLogResponse(
        id=str(log.id),
        sessionId=str(log.session_id),
        keyboardCount=log.keyboard_count,
        mouseMovement=log.mouse_distance,
        mouseClicks=log.mouse_clicks,
        idleTime=log.idle_time,
        activeApplication=log.active_application,
        createdAt=log.created_at.isoformat() + "Z"
    )
