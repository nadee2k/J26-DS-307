from pydantic import BaseModel, Field
from typing import Optional, List, Generic, TypeVar, Literal
from datetime import datetime
from uuid import UUID

T = TypeVar('T')


class PaginatedResponse(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    pageSize: int
    totalPages: int


# Student Schemas
class StudentBase(BaseModel):
    name: str
    age: int
    gender: str
    university: Optional[str] = None
    faculty: Optional[str] = None
    degree: Optional[str] = None
    learningType: Optional[str] = None


class StudentCreate(StudentBase):
    pass


class StudentUpdate(BaseModel):
    name: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    university: Optional[str] = None
    faculty: Optional[str] = None
    degree: Optional[str] = None
    learningType: Optional[str] = None


class StudentResponse(StudentBase):
    id: UUID
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


# Study Session Schemas
class SessionBase(BaseModel):
    studentId: UUID
    taskType: str
    location: Optional[str] = None
    expectedDuration: Optional[int] = None
    status: str = "idle"
    startedAt: Optional[datetime] = None
    pausedAt: Optional[datetime] = None
    endedAt: Optional[datetime] = None


class SessionCreate(SessionBase):
    pass


class SessionUpdate(BaseModel):
    taskType: Optional[str] = None
    location: Optional[str] = None
    expectedDuration: Optional[int] = None


class SessionResponse(BaseModel):
    id: UUID
    studentId: UUID
    taskType: str
    location: Optional[str] = None
    expectedDuration: Optional[int] = None
    status: str
    startedAt: Optional[datetime] = None
    pausedAt: Optional[datetime] = None
    endedAt: Optional[datetime] = None
    createdAt: datetime
    updatedAt: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


# Environment Log Schemas
class EnvironmentLogBase(BaseModel):
    sessionId: UUID
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light: Optional[int] = None
    noise: Optional[int] = None
    motion: Optional[bool] = None


class EnvironmentLogCreate(EnvironmentLogBase):
    pass


class EnvironmentLogResponse(BaseModel):
    id: UUID
    sessionId: UUID
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    light: Optional[int] = None
    noise: Optional[int] = None
    motion: Optional[bool] = None
    createdAt: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


# Behavior Log Schemas
class BehaviorLogBase(BaseModel):
    sessionId: UUID
    keyboardCount: Optional[int] = 0
    mouseMovement: Optional[float] = 0.0
    mouseClicks: Optional[int] = 0
    idleTime: Optional[float] = 0.0
    activeApplication: Optional[str] = None


class BehaviorLogCreate(BehaviorLogBase):
    pass


class BehaviorLogResponse(BaseModel):
    id: UUID
    sessionId: UUID
    keyboardCount: Optional[int] = 0
    mouseMovement: Optional[float] = 0.0
    mouseClicks: Optional[int] = 0
    idleTime: Optional[float] = 0.0
    activeApplication: Optional[str] = None
    createdAt: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


# Vision Log Schemas
class VisionLogBase(BaseModel):
    sessionId: UUID
    faceDetected: Optional[bool] = None
    eyeGaze: Optional[str] = None
    headDirection: Optional[str] = None
    phoneDetected: Optional[bool] = None


class VisionLogCreate(VisionLogBase):
    pass


class VisionLogResponse(BaseModel):
    id: UUID
    sessionId: UUID
    faceDetected: Optional[bool] = None
    eyeGaze: Optional[str] = None
    headDirection: Optional[str] = None
    phoneDetected: Optional[bool] = None
    createdAt: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


# Component 1 epoch schemas (numeric features only – never key content)
class C1EpochBase(BaseModel):
    studentId: Optional[UUID] = None
    sessionId: Optional[UUID] = None
    recordedAt: Optional[datetime] = None
    studyMode: Optional[str] = None
    taskType: Optional[str] = None
    epochSeconds: int = 60
    source: Literal["desktop", "browser"] = "desktop"
    activeApplication: Optional[str] = None

    typingRate: float = 0.0
    interKeyVar: float = 0.0
    backspaceRatio: float = 0.0
    idleRatio: float = 0.0
    mouseSpeed: float = 0.0
    switchRate: float = 0.0
    scrollRate: float = 0.0
    keyboardActive: bool = False
    state: int = 0
    stateLabel: Optional[str] = None
    dwell: int = 1
    changes: int = 0
    awayShare: float = 0.0
    focusProb: Optional[float] = None


class C1EpochCreate(C1EpochBase):
    pass


class C1EpochResponse(C1EpochBase):
    id: UUID
    studentId: Optional[UUID] = None
    sessionId: Optional[UUID] = None
    recordedAt: datetime
    createdAt: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


# Concentration Log Schemas
class ConcentrationLogBase(BaseModel):
    sessionId: UUID
    level: int
    environment: str
    notes: Optional[str] = None


class ConcentrationLogCreate(ConcentrationLogBase):
    pass


class ConcentrationLogResponse(BaseModel):
    id: UUID
    sessionId: UUID
    level: int
    environment: str
    notes: Optional[str] = None
    recordedAt: datetime

    class Config:
        from_attributes = True
        populate_by_name = True


# Telemetry Stream Schemas
class TelemetryStreamBase(BaseModel):
    label: str
    state: str = "INACTIVE"


class TelemetryStreamResponse(BaseModel):
    id: UUID
    label: str
    state: str

    class Config:
        from_attributes = True
        populate_by_name = True
