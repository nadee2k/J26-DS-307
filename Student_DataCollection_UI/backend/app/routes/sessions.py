from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from uuid import UUID

from app.config.database import get_db
from app.models.models import StudySession, SessionState, TaskType, StudyLocation
from app.schemas.schemas import SessionCreate, SessionUpdate, SessionResponse, PaginatedResponse
from datetime import datetime

router = APIRouter()


def session_to_response(s: StudySession) -> SessionResponse:
    return SessionResponse(
        id=str(s.id),
        studentId=str(s.student_id),
        taskType=s.task_type.value,
        location=s.location.value if s.location else None,
        expectedDuration=s.expected_duration,
        status=s.status.value,
        startedAt=s.started_at.isoformat() + "Z" if s.started_at else None,
        pausedAt=s.paused_at.isoformat() + "Z" if s.paused_at else None,
        endedAt=s.ended_at.isoformat() + "Z" if s.ended_at else None,
        createdAt=s.created_at.isoformat() + "Z",
        updatedAt=s.updated_at.isoformat() + "Z"
    )


@router.get("/api/sessions", response_model=PaginatedResponse[SessionResponse])
async def list_sessions(
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    studentId: Optional[UUID] = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(StudySession)
    count_query = select(func.count(StudySession.id))

    if studentId:
        query = query.where(StudySession.student_id == studentId)
        count_query = count_query.where(StudySession.student_id == studentId)

    result = await db.execute(query.order_by(StudySession.created_at.desc()).offset((page - 1) * pageSize).limit(pageSize))
    sessions = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return PaginatedResponse(
        items=[session_to_response(s) for s in sessions],
        total=total,
        page=page,
        pageSize=pageSize,
        totalPages=(total + pageSize - 1) // pageSize
    )


@router.get("/api/sessions/{session_id}", response_model=SessionResponse)
async def get_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session_to_response(session)


@router.post("/api/sessions", response_model=SessionResponse)
async def create_session(session: SessionCreate, db: AsyncSession = Depends(get_db)):
    db_session = StudySession(
        student_id=session.studentId,
        task_type=TaskType(session.taskType),
        location=StudyLocation(session.location) if session.location else None,
        expected_duration=session.expectedDuration,
        status=SessionState(session.status),
        started_at=session.startedAt,
        paused_at=session.pausedAt,
        ended_at=session.endedAt
    )
    db.add(db_session)
    await db.flush()
    await db.refresh(db_session)
    return session_to_response(db_session)


@router.put("/api/sessions/{session_id}", response_model=SessionResponse)
async def update_session(session_id: UUID, data: SessionUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if data.taskType is not None:
        session.task_type = TaskType(data.taskType)
    if data.location is not None:
        session.location = StudyLocation(data.location)
    if data.expectedDuration is not None:
        session.expected_duration = data.expectedDuration
    session.updated_at = datetime.utcnow()

    await db.flush()
    await db.refresh(session)
    return session_to_response(session)


@router.post("/api/sessions/{session_id}/start", response_model=SessionResponse)
async def start_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = SessionState.running
    session.started_at = datetime.utcnow()
    session.updated_at = datetime.utcnow()

    await db.flush()
    await db.refresh(session)
    return session_to_response(session)


@router.post("/api/sessions/{session_id}/pause", response_model=SessionResponse)
async def pause_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = SessionState.paused
    session.paused_at = datetime.utcnow()
    session.updated_at = datetime.utcnow()

    await db.flush()
    await db.refresh(session)
    return session_to_response(session)


@router.post("/api/sessions/{session_id}/resume", response_model=SessionResponse)
async def resume_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = SessionState.running
    session.paused_at = None
    session.updated_at = datetime.utcnow()

    await db.flush()
    await db.refresh(session)
    return session_to_response(session)


@router.post("/api/sessions/{session_id}/stop", response_model=SessionResponse)
async def stop_session(session_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StudySession).where(StudySession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.status = SessionState.completed
    session.ended_at = datetime.utcnow()
    session.updated_at = datetime.utcnow()

    await db.flush()
    await db.refresh(session)
    return session_to_response(session)
