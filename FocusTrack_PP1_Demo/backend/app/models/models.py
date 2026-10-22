import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, Enum as SQLEnum, Text, Float, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.config.database import Base
import enum


class Gender(str, enum.Enum):
    male = "male"
    female = "female"


class LearningType(str, enum.Enum):
    screen = "screen"
    non_screen = "non-screen"


class TaskType(str, enum.Enum):
    reading = "reading"
    coding = "coding"
    writing = "writing"
    zoom = "zoom"
    assignment = "assignment"


class StudyLocation(str, enum.Enum):
    home = "home"
    library = "library"
    campus = "campus"


class SessionState(str, enum.Enum):
    idle = "idle"
    running = "running"
    paused = "paused"
    completed = "completed"


class Environment(str, enum.Enum):
    campus = "campus"
    house = "house"
    study_area = "study-area"
    library = "library"
    public = "public"


class ConcentrationLevel(int, enum.Enum):
    one = 1
    two = 2
    three = 3
    four = 4
    five = 5


class TelemetryStreamState(str, enum.Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"
    STANDBY = "STANDBY"


class Student(Base):
    __tablename__ = "students"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    age = Column(Integer, nullable=False)
    gender = Column(SQLEnum(Gender), nullable=False)
    university = Column(String, nullable=True)
    faculty = Column(String, nullable=True)
    degree = Column(String, nullable=True)
    learning_type = Column(SQLEnum(LearningType), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    sessions = relationship("StudySession", back_populates="student")


class StudySession(Base):
    __tablename__ = "study_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id = Column(UUID(as_uuid=True), ForeignKey("students.id"), nullable=False)
    task_type = Column(SQLEnum(TaskType), nullable=False)
    location = Column(SQLEnum(StudyLocation), nullable=True)
    expected_duration = Column(Integer, nullable=True)
    status = Column(SQLEnum(SessionState), default=SessionState.idle, nullable=False)
    started_at = Column(DateTime, nullable=True)
    paused_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    student = relationship("Student", back_populates="sessions")
    concentration_logs = relationship("ConcentrationLog", back_populates="session")
    environment_logs = relationship("EnvironmentLog", back_populates="session")
    behavior_logs = relationship("BehaviorLog", back_populates="session")
    vision_logs = relationship("VisionLog", back_populates="session")
    c1_epochs = relationship("C1Epoch", back_populates="session")


class EnvironmentLog(Base):
    __tablename__ = "environment_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("study_sessions.id"), nullable=False)
    temperature = Column(Float, nullable=True)
    humidity = Column(Float, nullable=True)
    light = Column(Integer, nullable=True)
    noise = Column(Integer, nullable=True)
    motion = Column(Boolean, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("StudySession", back_populates="environment_logs")


class BehaviorLog(Base):
    __tablename__ = "behavior_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("study_sessions.id"), nullable=False)
    keyboard_count = Column(Integer, nullable=False, default=0)
    mouse_distance = Column(Float, nullable=False, default=0.0)
    mouse_clicks = Column(Integer, nullable=False, default=0)
    idle_time = Column(Float, nullable=False, default=0.0)
    active_application = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("StudySession", back_populates="behavior_logs")


class VisionLog(Base):
    __tablename__ = "vision_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("study_sessions.id"), nullable=False)
    face_detected = Column(Boolean, nullable=True)
    eye_gaze = Column(String, nullable=True)
    head_direction = Column(String, nullable=True)
    phone_detected = Column(Boolean, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("StudySession", back_populates="vision_logs")


class C1Epoch(Base):
    """One numeric Component 1 feature epoch. No key content or raw input events are stored."""

    __tablename__ = "c1_epochs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    student_id = Column(UUID(as_uuid=True), ForeignKey("students.id", ondelete="CASCADE"), nullable=True)
    session_id = Column(UUID(as_uuid=True), ForeignKey("study_sessions.id", ondelete="SET NULL"), nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    study_mode = Column(String, nullable=True)
    task_type = Column(String, nullable=True)
    epoch_seconds = Column(Integer, nullable=False, default=60)
    source = Column(String, nullable=False, default="desktop")
    active_application = Column(String, nullable=True)

    typing_rate = Column(Float, nullable=False, default=0.0)
    inter_key_var = Column(Float, nullable=False, default=0.0)
    backspace_ratio = Column(Float, nullable=False, default=0.0)
    idle_ratio = Column(Float, nullable=False, default=0.0)
    mouse_speed = Column(Float, nullable=False, default=0.0)
    switch_rate = Column(Float, nullable=False, default=0.0)
    scroll_rate = Column(Float, nullable=False, default=0.0)
    keyboard_active = Column(Boolean, nullable=False, default=False)
    interaction_state = Column(Integer, nullable=False, default=0)
    state_label = Column(String, nullable=True)
    dwell = Column(Integer, nullable=False, default=1)
    changes = Column(Integer, nullable=False, default=0)
    away_share = Column(Float, nullable=False, default=0.0)
    focus_prob = Column(Float, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("StudySession", back_populates="c1_epochs")


class ConcentrationLog(Base):
    __tablename__ = "concentration_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("study_sessions.id"), nullable=False)
    level = Column(Integer, nullable=False)
    environment = Column(SQLEnum(Environment), nullable=False)
    notes = Column(Text, nullable=True)
    recorded_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    session = relationship("StudySession", back_populates="concentration_logs")


class TelemetryStream(Base):
    __tablename__ = "telemetry_streams"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    label = Column(String, nullable=False)
    state = Column(SQLEnum(TelemetryStreamState), default=TelemetryStreamState.INACTIVE, nullable=False)
