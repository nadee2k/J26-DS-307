export type SessionState = "idle" | "running" | "paused" | "completed"

export type TelemetryStreamState = "ACTIVE" | "INACTIVE" | "STANDBY"

export interface TelemetryStream {
  id?: string
  label: string
  state: TelemetryStreamState
}

export type ConcentrationLevel = 1 | 2 | 3 | 4 | 5

export type LearningType = "screen" | "non-screen"

export type StudyLocation = "home" | "library" | "campus"

export interface Student {
  id: string
  name: string
  age: number
  gender: "female" | "male"
  university?: string | null
  faculty?: string | null
  degree?: string | null
  learningType?: LearningType | null
  createdAt: string
  updatedAt: string
}

export interface StudySession {
  id: string
  studentId: string
  taskType: TaskType
  location?: StudyLocation | null
  expectedDuration?: number | null
  status: SessionState
  startedAt: string | null
  pausedAt: string | null
  endedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface EnvironmentLog {
  id: string
  sessionId: string
  temperature?: number | null
  humidity?: number | null
  light?: number | null
  noise?: number | null
  motion?: boolean | null
  createdAt: string
}

export interface BehaviorLog {
  id: string
  sessionId: string
  keyboardCount?: number | null
  mouseMovement?: number | null
  mouseClicks?: number | null
  idleTime?: number | null
  activeApplication?: string | null
  createdAt: string
}

export interface VisionLog {
  id: string
  sessionId: string
  faceDetected?: boolean | null
  eyeGaze?: string | null
  headDirection?: string | null
  phoneDetected?: boolean | null
  createdAt: string
}

export interface ConcentrationLog {
  id: string
  sessionId: string
  level: ConcentrationLevel
  environment: Environment
  notes: string | null
  recordedAt: string
}

export type TaskType = "reading" | "coding" | "writing" | "zoom" | "assignment"

export type Environment = "campus" | "house" | "study-area" | "library" | "public"

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}
