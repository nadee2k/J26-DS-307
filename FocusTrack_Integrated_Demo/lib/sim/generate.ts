// Generates a simulated FocusTrack study that follows the shared protocol:
// 22 participants × 6 sessions × 50 one-minute epochs, focus probes every 8–12 minutes,
// observer audits in library/campus sessions, and a 3-zone gaze calibration per participant.
// The hidden "focus" process drives all three sensing streams, so the analyses have something real to find.

import { createRng, clamp, type Rng } from "./rng"
import type { CalibrationSample, Epoch, Probe, Room, SimParticipant, SimSession, SimStudy, SimTask, StudyMode, Truth } from "./types"

const SCREEN_TASKS: SimTask[] = ["coding", "writing", "assignment", "zoom"]
const PAPER_TASKS: SimTask[] = ["reading", "handwriting"]
const EPOCHS = 50

const ROOM_ENV: Record<Room, { temp: number; humidity: number; light: number; noise: number; spike: number; motion: number }> = {
  home: { temp: 29, humidity: 76, light: 260, noise: 47, spike: 0.05, motion: 0.15 },
  library: { temp: 24, humidity: 56, light: 460, noise: 38, spike: 0.01, motion: 0.05 },
  campus: { temp: 27, humidity: 68, light: 360, noise: 54, spike: 0.08, motion: 0.25 },
}

const TASK_TYPING: Record<SimTask, number> = { coding: 85, writing: 120, assignment: 70, zoom: 14, reading: 1, handwriting: 1 }

function makeParticipant(i: number, rng: Rng): SimParticipant {
  const usualMode: StudyMode = i % 2 === 0 ? "screen" : "non-screen"
  const faculty = usualMode === "screen" ? (rng.chance(0.8) ? "Computing" : "Business") : rng.pick(["Business", "Humanities", "Computing"])
  return {
    id: `p${String(i + 1).padStart(2, "0")}`,
    code: `P${String(i + 1).padStart(2, "0")}`,
    usualMode,
    faculty,
    glasses: rng.chance(0.3),
    baseFocus: clamp(rng.normal(0.66, 0.07), 0.45, 0.85),
    ratingBias: rng.normal(0, 0.45),
    noiseSensitivity: 0.2 + rng.next() * 0.9,
    tempOptimum: rng.normal(25.5, 1.3),
    phoneProneness: 0.015 + rng.next() * 0.05,
    deskPitch: rng.normal(31, 5),
    screenPitch: rng.normal(3, 3),
    irisBias: [rng.normal(0, 0.3), rng.normal(0, 0.3)],
  }
}

function simulateSession(p: SimParticipant, index: number, room: Room, rng: Rng): SimSession {
  const mode: StudyMode = rng.chance(0.75) ? p.usualMode : p.usualMode === "screen" ? "non-screen" : "screen"
  const task = mode === "screen" ? rng.pick(SCREEN_TASKS) : rng.pick(PAPER_TASKS)
  const env = ROOM_ENV[room]
  const startHour = rng.int(8, 21)
  const lateness = startHour >= 19 ? 0.05 : 0
  const epochs: Epoch[] = []

  let focus = clamp(p.baseFocus + rng.normal(0, 0.05) - lateness, 0.1, 0.95)
  let temp = env.temp + rng.normal(0, 1.2)
  const humidity0 = env.humidity + rng.normal(0, 5)
  const light0 = env.light * (0.8 + rng.next() * 0.4)
  let phoneLeft = 0
  let wanderLeft = 0
  let spikeLeft = 0
  const noiseHist: number[] = []
  // separate stream for values that must not change the main random sequence (keeps the rest of the study identical)
  const aux = createRng(9973 * (index + 1) + p.id.charCodeAt(1) * 131 + p.id.charCodeAt(2))

  for (let t = 0; t < EPOCHS; t++) {
    // environment
    temp += rng.normal(0, 0.08)
    if (spikeLeft === 0 && rng.chance(env.spike)) spikeLeft = rng.int(2, 6)
    const noise = env.noise + rng.normal(0, 2.5) + (spikeLeft > 0 ? 14 + rng.normal(0, 3) : 0)
    if (spikeLeft > 0) spikeLeft--
    noiseHist.push(noise)
    const laggedNoise = noiseHist[Math.max(0, t - 3)]
    const humidity = humidity0 + rng.normal(0, 1.5)
    const light = light0 + rng.normal(0, 15)
    const motion = rng.chance(env.motion) ? 1 : 0

    // hidden focus dynamics: decay over the session, environmental penalties, distraction episodes
    const envPenalty = p.noiseSensitivity * Math.max(0, laggedNoise - 50) / 30 * 0.45 + 0.025 * Math.abs(temp - p.tempOptimum)
    const target = p.baseFocus - 0.14 * (t / EPOCHS) - envPenalty - lateness
    if (phoneLeft === 0 && wanderLeft === 0) {
      if (rng.chance(p.phoneProneness * (1 + 2.5 * (1 - focus)))) phoneLeft = rng.int(1, 5)
      else if (rng.chance(0.02 + 0.03 * (1 - focus))) wanderLeft = rng.int(1, 3)
    }
    let truth: Truth = "focused"
    if (phoneLeft > 0) { truth = "phone"; phoneLeft-- }
    else if (wanderLeft > 0) { truth = "wander"; wanderLeft-- }
    focus = focus + 0.3 * (target - focus) + rng.normal(0, 0.035)
    if (truth === "phone") focus = Math.min(focus, 0.22 + rng.normal(0, 0.05))
    if (truth === "wander") focus = Math.min(focus, 0.38 + rng.normal(0, 0.05))
    focus = clamp(focus, 0.02, 0.98)
    const f = focus

    // C1 behaviour – depends on study mode and task, not only on focus
    let typingRate: number, idleRatio: number, switchRate: number, mouseSpeed: number
    if (mode === "screen") {
      const active = truth === "focused" ? 0.45 + 0.75 * f : truth === "phone" ? 0.04 : 0.15
      typingRate = Math.max(0, TASK_TYPING[task] * active + rng.normal(0, 6))
      idleRatio = clamp((truth === "phone" ? 0.88 : 0.12 + 0.55 * (1 - f)) + rng.normal(0, 0.05), 0, 1)
      switchRate = Math.max(0, 0.6 + 2.8 * (1 - f) + (truth === "wander" ? 2.2 : 0) + rng.normal(0, 0.4))
      mouseSpeed = Math.max(0, (task === "zoom" ? 260 : 180) * (truth === "phone" ? 0.1 : 0.6 + 0.4 * f) + rng.normal(0, 25))
    } else {
      const interrupt = truth === "wander" && rng.chance(0.5)
      typingRate = Math.max(0, (interrupt ? 22 : 1) + rng.normal(0, 1.5))
      idleRatio = clamp((interrupt ? 0.5 : 0.95) + rng.normal(0, 0.03), 0, 1)
      switchRate = Math.max(0, (interrupt ? 2.5 : 0.1) + rng.normal(0, 0.15))
      mouseSpeed = Math.max(0, (interrupt ? 120 : 8) + rng.normal(0, 6))
    }
    let interKeyVar = Math.max(0.05, 0.25 + 0.55 * (1 - f) + rng.normal(0, 0.08))
    let backspaceRatio = clamp(0.07 + 0.09 * (1 - f) + rng.normal(0, 0.02), 0, 1)
    // typing rhythm and corrections carry no information when (almost) nothing is typed – e.g. reading on paper –
    // so they are uninformative there (an earlier version leaked hidden focus through them)
    if (typingRate < 10) { interKeyVar = Math.max(0.05, 0.55 + aux.normal(0, 0.12)); backspaceRatio = clamp(0.12 + aux.normal(0, 0.03), 0, 1) }

    // C3 vision – where the learner looks
    let zoneScreen: number, zoneDesk: number, zoneAway: number, pitchMean: number, readingMotion: number, yawStd: number
    let phoneVisible = false
    if (truth === "focused") {
      if (mode === "screen") { zoneScreen = 0.86; zoneDesk = 0.05; zoneAway = 0.09; pitchMean = p.screenPitch; readingMotion = 0.25 }
      else { zoneScreen = 0.05; zoneDesk = 0.85; zoneAway = 0.1; pitchMean = p.deskPitch; readingMotion = 0.7 }
      yawStd = 4
    } else if (truth === "phone") {
      zoneScreen = 0.05; zoneDesk = 0.4; zoneAway = 0.55; pitchMean = p.deskPitch + rng.normal(6, 6); readingMotion = 0.2; yawStd = 5
      phoneVisible = rng.chance(0.55)
    } else {
      zoneScreen = 0.15; zoneDesk = mode === "non-screen" ? 0.4 : 0.15; zoneAway = mode === "non-screen" ? 0.45 : 0.7; pitchMean = mode === "non-screen" && rng.chance(0.5) ? p.deskPitch + rng.normal(0, 5) : rng.normal(-2, 8); readingMotion = 0.15; yawStd = 13
    }
    const jitter = () => rng.normal(0, 0.09)
    zoneScreen = clamp(zoneScreen + jitter(), 0, 1); zoneDesk = clamp(zoneDesk + jitter(), 0, 1); zoneAway = clamp(zoneAway + jitter(), 0, 1)
    const zs = zoneScreen + zoneDesk + zoneAway
    epochs.push({
      t, focus: f, truth, phoneVisible,
      typingRate, interKeyVar, backspaceRatio, idleRatio, mouseSpeed, switchRate,
      keyboardActive: typingRate > 10,
      temp, humidity, light, noise, motion,
      pitchMean: pitchMean + rng.normal(0, 5),
      yawStd: Math.max(0, yawStd + rng.normal(0, 1.5)),
      zoneScreen: zoneScreen / zs, zoneDesk: zoneDesk / zs, zoneAway: zoneAway / zs,
      readingMotion: clamp(readingMotion + rng.normal(0, 0.18), 0, 1),
      phoneInFrame: phoneVisible ? clamp(0.6 + rng.normal(0, 0.15), 0, 1) : clamp(rng.normal(0.01, 0.02), 0, 1),
      validFace: clamp(0.96 - (p.glasses ? 0.08 : 0) + rng.normal(0, 0.02), 0, 1),
      glare: p.glasses ? clamp(0.15 + rng.normal(0, 0.05), 0, 1) : 0,
    })
  }

  // probes at random 8–12 minute intervals; each rates the previous 5 minutes
  const probes: Probe[] = []
  let next = rng.int(8, 12)
  const observed = room !== "home"
  while (next < EPOCHS) {
    const window = epochs.slice(Math.max(0, next - 5), next)
    const meanF = window.reduce((s, e) => s + e.focus, 0) / window.length
    const rating = clamp(Math.round(1 + 4 * meanF + p.ratingBias + rng.normal(0, 0.35)), 1, 5)
    const observer = observed ? clamp(Math.round(1 + 4 * meanF + rng.normal(0, 0.55)), 1, 5) : null
    probes.push({ t: next, rating, observer })
    next += rng.int(8, 12)
  }
  const meanAll = epochs.reduce((s, e) => s + e.focus, 0) / epochs.length
  return {
    id: `${p.id}-s${index + 1}`,
    pid: p.id,
    index,
    mode,
    task,
    room,
    startHour,
    epochs,
    probes,
    sessionRating: clamp(Math.round(1 + 4 * meanAll + p.ratingBias + rng.normal(0, 0.35)), 1, 5),
  }
}

function calibrationFor(p: SimParticipant, rng: Rng): CalibrationSample[] {
  const out: CalibrationSample[] = []
  const zoneCentres: Record<0 | 1 | 2, [number, number, number, number]> = {
    0: [0, 0.1, p.screenPitch, 0],
    1: [0, -0.55, p.deskPitch, 0],
    2: [0.75, 0.2, -5, 30],
  }
  for (const heldOut of [false, true]) {
    for (const zone of [0, 1, 2] as const) {
      const n = heldOut ? 20 : 30
      for (let i = 0; i < n; i++) {
        const c = zoneCentres[zone]
        const side = zone === 2 && rng.chance(0.5) ? -1 : 1
        out.push({
          pid: p.id,
          zone,
          heldOut,
          x: [
            side * c[0] + p.irisBias[0] + rng.normal(0, 0.12),
            c[1] + p.irisBias[1] + rng.normal(0, 0.12),
            c[2] + rng.normal(0, 4),
            side * c[3] + rng.normal(0, 6),
          ],
        })
      }
    }
  }
  return out
}

export function generateStudy(seed = 2026, nParticipants = 22, sessionsEach = 6): SimStudy {
  const rng = createRng(seed)
  const participants = Array.from({ length: nParticipants }, (_, i) => makeParticipant(i, rng))
  const sessions: SimSession[] = []
  const calibration: CalibrationSample[] = []
  for (const p of participants) {
    // every participant studies in at least two room types
    const rooms: Room[] = []
    const order: Room[] = rng.chance(0.5) ? ["home", "library", "campus"] : ["home", "campus", "library"]
    for (let s = 0; s < sessionsEach; s++) rooms.push(s < 2 ? order[s] : rng.pick(order))
    for (let s = 0; s < sessionsEach; s++) sessions.push(simulateSession(p, s, rooms[s], rng))
    calibration.push(...calibrationFor(p, rng))
  }
  return { seed, participants, sessions, calibration }
}
