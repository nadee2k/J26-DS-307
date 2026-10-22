// Types for the simulated FocusTrack study. Simulated data only – used to demonstrate and test the
// analysis pipeline before real data collection. Never report these numbers as research findings.

export type StudyMode = "screen" | "non-screen"
export type SimTask = "coding" | "writing" | "assignment" | "zoom" | "reading" | "handwriting"
export type Room = "home" | "library" | "campus"
export type Truth = "focused" | "phone" | "wander"

export interface SimParticipant {
  id: string
  code: string
  usualMode: StudyMode
  faculty: string
  glasses: boolean
  // hidden traits (ground truth of the simulator)
  baseFocus: number
  ratingBias: number
  noiseSensitivity: number
  tempOptimum: number
  phoneProneness: number
  deskPitch: number
  screenPitch: number
  irisBias: [number, number]
}

export interface Epoch {
  t: number
  // simulator ground truth
  focus: number
  truth: Truth
  phoneVisible: boolean
  // C1 behaviour
  typingRate: number
  interKeyVar: number
  backspaceRatio: number
  idleRatio: number
  mouseSpeed: number
  switchRate: number
  keyboardActive: boolean
  // C2 environment
  temp: number
  humidity: number
  light: number
  noise: number
  motion: number
  // C3 vision
  pitchMean: number
  yawStd: number
  zoneScreen: number
  zoneDesk: number
  zoneAway: number
  readingMotion: number
  phoneInFrame: number
  validFace: number
  glare: number
}

export interface Probe {
  t: number
  rating: number
  observer: number | null
}

export interface SimSession {
  id: string
  pid: string
  index: number
  mode: StudyMode
  task: SimTask
  room: Room
  startHour: number
  epochs: Epoch[]
  probes: Probe[]
  sessionRating: number
}

export interface CalibrationSample {
  pid: string
  zone: 0 | 1 | 2 // 0 = screen, 1 = desk, 2 = away
  x: [number, number, number, number] // iris x, iris y, pitch, yaw
  heldOut: boolean
}

export interface SimStudy {
  seed: number
  participants: SimParticipant[]
  sessions: SimSession[]
  calibration: CalibrationSample[]
}
