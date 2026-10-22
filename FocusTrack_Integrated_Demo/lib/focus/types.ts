// Shared types for the live FocusTrack pipeline. Field names and units match the simulated study
// (lib/sim/types.ts) so that models trained on the simulator can score live sessions.

export type StudyMode = "screen" | "non-screen"
export type LiveTask = "coding" | "writing" | "assignment" | "zoom" | "reading" | "handwriting"
export type Zone = 0 | 1 | 2 // 0 = screen, 1 = desk, 2 = away

export const SCREEN_TASKS: LiveTask[] = ["coding", "writing", "assignment", "zoom"]
export const PAPER_TASKS: LiveTask[] = ["reading", "handwriting"]
export const TASK_LABELS: Record<LiveTask, string> = {
  coding: "Coding", writing: "Writing on the laptop", assignment: "Assignment work", zoom: "Online lecture",
  reading: "Reading printed notes", handwriting: "Writing by hand",
}
export const tasksFor = (mode: StudyMode) => (mode === "screen" ? SCREEN_TASKS : PAPER_TASKS)

/** C1 – one epoch of interaction metadata (never key content). Rates are per minute. */
export interface C1Features {
  typingRate: number // key presses per minute
  interKeyVar: number // coefficient of variation of inter-key intervals (< 2 s apart)
  backspaceRatio: number // share of key presses that were Backspace/Delete
  idleRatio: number // share of seconds with no keyboard, mouse or scroll input
  mouseSpeed: number // mouse travel, px per second
  switchRate: number // times the learner left the app, per minute
  scrollRate: number // scroll events per minute
  keyboardActive: boolean
  state: number // interaction state (cluster) index
  stateLabel: string
  dwell: number // consecutive epochs in the current state
  changes: number // state changes in the last 5 epochs
  awayShare: number // share of the epoch the app was hidden / not focused
}

/** C2 – one epoch of room conditions after cleaning. */
export interface C2Features {
  temp: number | null
  humidity: number | null
  light: number | null
  noise: number | null
  motion: number // share of seconds with motion
  noiseSd: number | null
  tempSlope: number | null // °C per minute
  readings: number
  missingRatio: number // share of expected 1-Hz readings missing or faulty
  outliersRemoved: number
  comfortNoise: number // dB outside the learner's noise comfort band (0 = inside)
  comfortTemp: number // °C outside the learner's temperature comfort band (0 = inside)
  calibrated: boolean // false when light/sound are raw ADC values without a calibration
}

/** C3 – one epoch of visual attention features. */
export interface C3Features {
  pitchMean: number
  yawStd: number
  zoneScreen: number
  zoneDesk: number
  zoneAway: number
  readingMotion: number
  phoneInFrame: number
  validFace: number
  glare: number
  lowLight: number
  dgdState: DgdState
  dgdShares: Record<DgdState, number>
  frames: number
  personalModel: boolean
}

export type DgdState = "screen" | "reading" | "typing" | "phone" | "away" | "unclear" | "no-face"
export const DGD_LABELS: Record<DgdState, string> = {
  screen: "Looking at the screen",
  reading: "Reading / writing on the desk",
  typing: "Looking at the keyboard while typing",
  phone: "Phone use",
  away: "Looking away",
  unclear: "Looking down – possible phone out of frame",
  "no-face": "No face in view",
}
export const DGD_FOCUSED: Record<DgdState, boolean | null> = {
  screen: true, reading: true, typing: true, phone: false, away: false, unclear: false, "no-face": null,
}

export interface Contribution { feature: string; value: number; changeable: boolean }

/** C4 – what the fusion component produced for one epoch. */
export interface C4Output {
  focusProb: number // P(focused) from the fused model; focus score = 100 × this
  c1FocusProb: number | null // behaviour-only estimate (C1)
  risk: number // P(focus drop in the next 5–10 minutes)
  threshold: number
  fusion: "feature-level" | "decision-level"
  streams: { c1: boolean; c2: boolean; c3: boolean }
  contributions: Contribution[]
  counterfactual: string | null
  alert: boolean
  alertSuppressed: string | null // why an over-threshold risk did not raise an alert
}

export interface CalibrationResult {
  id?: string
  sessionId: string
  studentId: string
  createdAt: string
  quick: boolean
  model: ZoneModelJson
  deskAnchor: number // mean head pitch while looking at the desk
  screenPitch: number
  nTrain: number
  nTest: number
  accuracyPersonal: number | null // zone accuracy on the held-out scripted check
  accuracyFixed: number | null // fixed-angle rule on the same frames
  phoneRecall: number | null // share of phone-cue frames where a phone was detected
  phoneFrames: number
  readingMotionRead: number | null // reading-motion score while reading (should be high)
  readingMotionPhone: number | null // … while using the phone (should be lower)
  perZone: { zone: Zone; n: number; personal: number; fixed: number }[]
}

export interface ZoneModelJson {
  mu: number[]
  sg: number[]
  W: number[][] // K × (d + 1), first column is the bias
}

