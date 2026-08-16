from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List
from uuid import UUID

from app.config.database import get_db
from app.models.models import Student, Gender, LearningType
from app.schemas.schemas import StudentCreate, StudentUpdate, StudentResponse, PaginatedResponse
from datetime import datetime

router = APIRouter()


def student_to_response(s: Student) -> StudentResponse:
    return StudentResponse(
        id=str(s.id),
        name=s.name,
        age=s.age,
        gender=s.gender.value,
        university=s.university,
        faculty=s.faculty,
        degree=s.degree,
        learningType=s.learning_type.value if s.learning_type else None,
        createdAt=s.created_at.isoformat() + "Z",
        updatedAt=s.updated_at.isoformat() + "Z"
    )


@router.get("/api/students", response_model=PaginatedResponse[StudentResponse])
async def list_students(
    page: int = Query(1, ge=1),
    pageSize: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    query = select(Student)
    count_query = select(func.count(Student.id))

    result = await db.execute(query.offset((page - 1) * pageSize).limit(pageSize))
    students = result.scalars().all()

    count_result = await db.execute(count_query)
    total = count_result.scalar()

    return PaginatedResponse(
        items=[student_to_response(s) for s in students],
        total=total,
        page=page,
        pageSize=pageSize,
        totalPages=(total + pageSize - 1) // pageSize
    )


@router.get("/api/students/{student_id}", response_model=StudentResponse)
async def get_student(student_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    return student_to_response(student)


@router.post("/api/students", response_model=StudentResponse)
async def create_student(student: StudentCreate, db: AsyncSession = Depends(get_db)):
    db_student = Student(
        name=student.name,
        age=student.age,
        gender=Gender(student.gender),
        university=student.university,
        faculty=student.faculty,
        degree=student.degree,
        learning_type=LearningType(student.learningType) if student.learningType else None
    )
    db.add(db_student)
    await db.flush()
    await db.refresh(db_student)
    return student_to_response(db_student)


@router.put("/api/students/{student_id}", response_model=StudentResponse)
async def update_student(student_id: UUID, student: StudentUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Student).where(Student.id == student_id))
    db_student = result.scalar_one_or_none()
    if not db_student:
        raise HTTPException(status_code=404, detail="Student not found")

    if student.name is not None:
        db_student.name = student.name
    if student.age is not None:
        db_student.age = student.age
    if student.gender is not None:
        db_student.gender = Gender(student.gender)
    if student.university is not None:
        db_student.university = student.university
    if student.faculty is not None:
        db_student.faculty = student.faculty
    if student.degree is not None:
        db_student.degree = student.degree
    if student.learningType is not None:
        db_student.learning_type = LearningType(student.learningType)
    db_student.updated_at = datetime.utcnow()

    await db.flush()
    await db.refresh(db_student)
    return student_to_response(db_student)


@router.delete("/api/students/{student_id}")
async def delete_student(student_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    await db.delete(student)
    return {"message": "Student deleted successfully"}
