import type { Contribution, LiveTask, StudyMode } from "@/lib/focus/types"

export type LearningType = StudyMode
export type Place = "home" | "library" | "campus"

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

export interface SessionConfig {
  task: LiveTask
  place: Place
  minutes: number
  streams: { c2: boolean; c3: boolean }
}

export interface Frame {
  t: number
  focusProb: number
  c1FocusProb: number | null
  risk: number
  contributions: Contribution[]
  counterfactual: string | null
  fusion: "feature-level" | "decision-level"
  streams: { c1: boolean; c2: boolean; c3: boolean }
  stateId: number
  stateLabel: string
  reasons: string[]
  env: { temp: number; humidity: number; light: number; noise: number; motion: number }
  vision: { zoneScreen: number; zoneDesk: number; zoneAway: number; phoneInFrame: number; readingMotion: number; validFace: number }
  c1: { typingRate: number; idleRatio: number; switchRate: number; mouseSpeed: number; interKeyVar: number; backspaceRatio: number; keyboardActive: boolean }
}

export interface ProbeMarker {
  t: number
  rating: number
  drop: boolean
}

export interface DemoRun {
  id: string
  studentId: string
  studentName: string
  createdAt: string
  config: SessionConfig
  mode: StudyMode
  frames: Frame[]
  probes: ProbeMarker[]
  participantCode: string
  modelSource: string
  /** Starting alert level, calibrated from this learner's own baseline in the first half of the session. */
  initialThreshold: number
}

export type AlertResponse = "helpful" | "not-now"

export interface RaisedAlert {
  id: string
  t: number
  risk: number
  threshold: number
  reasons: string[]
  counterfactual: string | null
  contributions: Contribution[]
  fusion: "feature-level" | "decision-level"
  streams: { c1: boolean; c2: boolean; c3: boolean }
  response: AlertResponse | null
}

export interface Feedback {
  rating: number
  alertHelpful: Record<string, boolean>
  accurate: number
  control: number
  wouldUse: number
  comment: string
  consent: boolean
}

export interface RunSummary {
  id: string
  createdAt: string
  config: SessionConfig
  mode: StudyMode
  avgFocus: number
  bestWindow: number
  interruptions: number
  alerts: number
  alertsActed: number
  hits: number
  probes: number
  drops: number
  stateShares: { label: string; share: number }[]
  topReasons: string[]
  noise: number
  temp: number
  phoneShare: number
  hero: string
  feedback?: Feedback
}

export interface SavedRun extends RunSummary {
  studentId: string
}
