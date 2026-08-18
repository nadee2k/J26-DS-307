from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID

from app.config.database import get_db
from app.models.models import VisionLog
from app.schemas.schemas import VisionLogCreate, VisionLogResponse, PaginatedResponse

router = APIRouter()


@router.get("/api/vision", response_model=PaginatedResponse[VisionLogResponse])
async def list_vision_logs(
    sessionId: UUID = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    query = select(VisionLog)
    count_query = select(func.count(VisionLog.id))

    if sessionId:
        query = query.where(VisionLog.session_id == sessionId)
        count_query = count_query.where(VisionLog.session_id == sessionId)

    result = await db.execute(query.order_by(VisionLog.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize))
    logs = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return PaginatedResponse(
        items=[
            VisionLogResponse(
                id=str(log.id),
                sessionId=str(log.session_id),
                faceDetected=log.face_detected,
                eyeGaze=log.eye_gaze,
                headDirection=log.head_direction,
                phoneDetected=log.phone_detected,
                createdAt=log.created_at.isoformat() + "Z"
            ) for log in logs
        ],
        total=total,
        page=page,
        pageSize=pageSize,
        totalPages=(total + pageSize - 1) // pageSize
    )


@router.post("/api/vision", response_model=VisionLogResponse)
async def create_vision_log(log: VisionLogCreate, db: AsyncSession = Depends(get_db)):
    db_log = VisionLog(
        session_id=log.sessionId,
        face_detected=log.faceDetected,
        eye_gaze=log.eyeGaze,
        head_direction=log.headDirection,
        phone_detected=log.phoneDetected
    )
    db.add(db_log)
    await db.flush()
    await db.refresh(db_log)
    return VisionLogResponse(
        id=str(db_log.id),
        sessionId=str(db_log.session_id),
        faceDetected=db_log.face_detected,
        eyeGaze=db_log.eye_gaze,
        headDirection=db_log.head_direction,
        phoneDetected=db_log.phone_detected,
        createdAt=db_log.created_at.isoformat() + "Z"
    )


@router.get("/api/vision/latest", response_model=VisionLogResponse)
async def get_latest_vision_log(
    sessionId: UUID = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(VisionLog)
    if sessionId:
        query = query.where(VisionLog.session_id == sessionId)
    query = query.order_by(VisionLog.created_at.desc()).limit(1)

    result = await db.execute(query)
    log = result.scalar_one_or_none()
    if not log:
        return None

    return VisionLogResponse(
        id=str(log.id),
        sessionId=str(log.session_id),
        faceDetected=log.face_detected,
        eyeGaze=log.eye_gaze,
        headDirection=log.head_direction,
        phoneDetected=log.phone_detected,
        createdAt=log.created_at.isoformat() + "Z"
    )
