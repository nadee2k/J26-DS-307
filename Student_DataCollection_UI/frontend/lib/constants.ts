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
  { value: "screen", label: "Screen" },
  { value: "non-screen", label: "Non-screen" },
]

export const STUDY_LOCATION_OPTIONS: { value: StudyLocation; label: string }[] = [
  { value: "home", label: "Home" },
  { value: "library", label: "Library" },
  { value: "campus", label: "Campus" },
  { value: "other", label: "Other" },
]

export const LOCATION_PRESETS = ["home", "library", "campus"] as const

export function locationSelectValue(location: string | null | undefined): string {
  if (!location) return ""
  if (location === "other" || LOCATION_PRESETS.includes(location as (typeof LOCATION_PRESETS)[number])) {
    return location
  }
  return "other"
}

export function locationOtherValue(location: string | null | undefined): string {
  if (!location) return ""
  if (LOCATION_PRESETS.includes(location as (typeof LOCATION_PRESETS)[number]) || location === "other") {
    return ""
  }
  return location
}

export function resolvedLocation(select: string, other: string): string {
  if (select === "other") return other.trim()
  return select
}

export function isLocationReady(select: string, other: string): boolean {
  if (!select) return false
  if (select === "other") return other.trim().length > 0
  return true
}

export const DEFAULT_TELEMETRY_STREAMS: TelemetryStream[] = [
  { label: "ESP32 Sensor Stream", state: "INACTIVE" },
  { label: "Behavior Logger", state: "INACTIVE" },
  { label: "Vision Logger (Camera)", state: "INACTIVE" },
]
