import type { ConcentrationLevel, Environment, TaskType, LearningType, StudyLocation, TelemetryStream, TelemetryStreamState } from "@/types"

export const CONCENTRATION_LEVELS: Record<ConcentrationLevel, string> = {
  1: "Fully Distracted",
  2: "Somewhat Distracted",
  3: "Neutral",
  4: "Engaged",
  5: "Deep Focus",
}

export const ENVIRONMENT_OPTIONS: { value: Environment; label: string }[] = [
  { value: "campus", label: "Campus" },
  { value: "house", label: "House" },
  { value: "study-area", label: "Study Area" },
  { value: "library", label: "Library" },
  { value: "public", label: "Public Place" },
]

export const TASK_OPTIONS: { value: TaskType; label: string }[] = [
  { value: "reading", label: "Reading" },
  { value: "coding", label: "Coding" },
  { value: "writing", label: "Writing" },
  { value: "zoom", label: "Zoom" },
  { value: "assignment", label: "Assignment" },
]

export const GENDER_OPTIONS: { value: "female" | "male"; label: string }[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
]

export const LEARNING_TYPE_OPTIONS: { value: LearningType; label: string }[] = [
  { value: "screen", label: "Screen Learner" },
  { value: "non-screen", label: "Non-screen Learner" },
]

export const STUDY_LOCATION_OPTIONS: { value: StudyLocation; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "library", label: "Library" },
  { value: "campus", label: "Campus" },
]

export const DEFAULT_TELEMETRY_STREAMS: TelemetryStream[] = [
  { label: "ESP32 Sensor Stream", state: "INACTIVE" },
  { label: "Behavior Logger", state: "INACTIVE" },
  { label: "Vision Logger (Camera)", state: "INACTIVE" },
]
