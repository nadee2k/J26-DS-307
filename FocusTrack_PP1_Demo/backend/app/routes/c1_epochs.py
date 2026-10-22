from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.database import get_db
from app.models.models import C1Epoch
from app.schemas.schemas import C1EpochCreate, C1EpochResponse, PaginatedResponse

router = APIRouter()


def _recorded_at(value: Optional[datetime]) -> datetime:
    """The table stores naive UTC timestamps, like the other log tables."""
    if value is None:
        return datetime.utcnow()
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def _to_response(row: C1Epoch) -> C1EpochResponse:
    return C1EpochResponse(
        id=str(row.id),
        studentId=str(row.student_id) if row.student_id else None,
        sessionId=str(row.session_id) if row.session_id else None,
        recordedAt=row.recorded_at,
        studyMode=row.study_mode,
        taskType=row.task_type,
        epochSeconds=row.epoch_seconds,
        source=row.source,
        activeApplication=row.active_application,
        typingRate=row.typing_rate,
        interKeyVar=row.inter_key_var,
        backspaceRatio=row.backspace_ratio,
        idleRatio=row.idle_ratio,
        mouseSpeed=row.mouse_speed,
        switchRate=row.switch_rate,
        scrollRate=row.scroll_rate,
        keyboardActive=row.keyboard_active,
        state=row.interaction_state,
        stateLabel=row.state_label,
        dwell=row.dwell,
        changes=row.changes,
        awayShare=row.away_share,
        focusProb=row.focus_prob,
        createdAt=row.created_at,
    )


@router.post("/api/c1/epochs", response_model=C1EpochResponse, status_code=201)
async def create_c1_epoch(epoch: C1EpochCreate, db: AsyncSession = Depends(get_db)):
    row = C1Epoch(
        student_id=epoch.studentId,
        session_id=epoch.sessionId,
        recorded_at=_recorded_at(epoch.recordedAt),
        study_mode=epoch.studyMode,
        task_type=epoch.taskType,
        epoch_seconds=epoch.epochSeconds,
        source=epoch.source,
        active_application=epoch.activeApplication,
        typing_rate=epoch.typingRate,
        inter_key_var=epoch.interKeyVar,
        backspace_ratio=epoch.backspaceRatio,
        idle_ratio=epoch.idleRatio,
        mouse_speed=epoch.mouseSpeed,
        switch_rate=epoch.switchRate,
        scroll_rate=epoch.scrollRate,
        keyboard_active=epoch.keyboardActive,
        interaction_state=epoch.state,
        state_label=epoch.stateLabel,
        dwell=epoch.dwell,
        changes=epoch.changes,
        away_share=epoch.awayShare,
        focus_prob=epoch.focusProb,
    )
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return _to_response(row)


@router.get("/api/c1/epochs", response_model=PaginatedResponse[C1EpochResponse])
async def list_c1_epochs(
    studentId: Optional[UUID] = None,
    sessionId: Optional[UUID] = None,
    page: int = Query(1, ge=1),
    pageSize: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    query = select(C1Epoch)
    count_query = select(func.count(C1Epoch.id))
    if studentId:
        query = query.where(C1Epoch.student_id == studentId)
        count_query = count_query.where(C1Epoch.student_id == studentId)
    if sessionId:
        query = query.where(C1Epoch.session_id == sessionId)
        count_query = count_query.where(C1Epoch.session_id == sessionId)

    result = await db.execute(
        query.order_by(C1Epoch.recorded_at.desc()).offset((page - 1) * pageSize).limit(pageSize)
    )
    rows = result.scalars().all()
    count_result = await db.execute(count_query)
    total = count_result.scalar() or 0

    return PaginatedResponse(
        items=[_to_response(row) for row in rows],
        total=total,
        page=page,
        pageSize=pageSize,
        totalPages=(total + pageSize - 1) // pageSize,
    )
