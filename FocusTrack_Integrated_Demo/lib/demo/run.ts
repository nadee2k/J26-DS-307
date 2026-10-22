import { generateStudy } from "@/lib/sim/generate"
import type { Epoch, SimSession } from "@/lib/sim/types"
import { getModels, stateModel, type Models } from "@/lib/focus/models"
import { scoreEpoch, zOf, type PolicyState } from "@/lib/focus/c4"
import type { C1Features, C2Features, C3Features, StudyMode } from "@/lib/focus/types"
import type { DemoRun, Frame, ProbeMarker, RaisedAlert, SessionConfig, Student } from "./types"

const BASE_POLICY: PolicyState = { threshold: 0.5, maxPerHour: 3, showAlerts: true, minGapEpochs: 10 }

export function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function modeOf(task: SessionConfig["task"]): StudyMode {
  return task === "reading" || task === "handwriting" ? "non-screen" : "screen"
}

const asC1 = (e: Epoch): C1Features => ({
  typingRate: e.typingRate,
  interKeyVar: e.interKeyVar,
  backspaceRatio: e.backspaceRatio,
  idleRatio: e.idleRatio,
  mouseSpeed: e.mouseSpeed,
  switchRate: e.switchRate,
  scrollRate: 0,
  keyboardActive: e.keyboardActive,
  state: 0,
  stateLabel: "",
  dwell: 1,
  changes: 0,
  awayShare: 0,
})

const outside = (v: number, b: [number, number]) => (v < b[0] ? b[0] - v : v > b[1] ? v - b[1] : 0)

const asC2 = (e: Epoch, band: { noise: [number, number]; temp: [number, number] }): C2Features => ({
  temp: e.temp,
  humidity: e.humidity,
  light: e.light,
  noise: e.noise,
  motion: e.motion,
  noiseSd: null,
  tempSlope: null,
  readings: 60,
  missingRatio: 0,
  outliersRemoved: 0,
  comfortNoise: outside(e.noise, band.noise),
  comfortTemp: outside(e.temp, band.temp),
  calibrated: true,
})

const asC3 = (e: Epoch): C3Features => ({
  pitchMean: e.pitchMean,
  yawStd: e.yawStd,
  zoneScreen: e.zoneScreen,
  zoneDesk: e.zoneDesk,
  zoneAway: e.zoneAway,
  readingMotion: e.readingMotion,
  phoneInFrame: e.phoneInFrame,
  validFace: e.validFace,
  glare: e.glare,
  lowLight: 0,
  dgdState: "screen",
  dgdShares: { screen: 0, reading: 0, typing: 0, phone: 0, away: 0, unclear: 0, "no-face": 0 },
  frames: 180,
  personalModel: true,
})

/** Show probabilities as percentages in the learner-facing copy. */
function asPercent(text: string | null) {
  return text ? text.replace(/\b0\.\d{2}\b/g, (m) => `${Math.round(Number(m) * 100)}%`) : null
}

function toFeat(c1: C1Features | null, c2: C2Features | null, c3: C3Features | null) {  return {
    typingRate: c1?.typingRate ?? 0,
    idleRatio: c1?.idleRatio ?? 1,
    switchRate: c1?.switchRate ?? 0,
    mouseSpeed: c1?.mouseSpeed ?? 0,
    interKeyVar: c1?.interKeyVar ?? 0.5,
    backspaceRatio: c1?.backspaceRatio ?? 0,
    noise: c2?.noise ?? 0,
    temp: c2?.temp ?? 0,
    zoneScreen: c3?.zoneScreen ?? 0,
    zoneDesk: c3?.zoneDesk ?? 0,
    zoneAway: c3?.zoneAway ?? 0,
    readingMotion: c3?.readingMotion ?? 0,
    phoneInFrame: c3?.phoneInFrame ?? 0,
  }
}

/** Probe ratings become learner-normalised z-scores; negative means a reported dip. */
function probeData(session: SimSession, n: number) {
  const history: number[] = []
  const map = new Map<number, number>()
  const probes: ProbeMarker[] = session.probes
    .filter((p) => p.t < n)
    .map((p) => {
      const z = zOf(p.rating, history)
      history.push(p.rating)
      map.set(p.t, z)
      return { t: p.t, rating: p.rating, drop: z <= -1 }
    })
  return { map, probes }
}

function lastZAt(map: Map<number, number>, t: number) {
  let bestT = -1
  let z = 0
  map.forEach((value, pt) => {
    if (pt <= t && pt > bestT) {
      bestT = pt
      z = value
    }
  })
  return z
}

/** Plain-language reason for an alert. Context-encoding features are not causes, so they are skipped. */
function friendlyReason(
  feature: string,
  ctx: { c2: C2Features | null; c3: C3Features | null; minutesOnTask: number; mode: StudyMode; lastZ: number },
): string | null {
  switch (feature) {
    case "noise":
      return ctx.c2?.noise != null
        ? `Noise is about ${Math.round(ctx.c2.noise)} dB${ctx.c2.comfortNoise > 0 ? ", above your comfort range" : ""}`
        : null
    case "temperature":
      return ctx.c2?.temp != null
        ? `Room temperature is ${ctx.c2.temp.toFixed(1)} °C${ctx.c2.comfortTemp > 0 ? ", outside your comfort range" : ""}`
        : null
    case "time on task (min)":
      return `${Math.round(ctx.minutesOnTask)} minutes on task without a break`
    case "phone in frame":
      return "Your phone has been in view"
    case "looking away":
      return "You have been looking away from your work"
    case "app switching":
      return "You have been switching between apps"
    case "idle time":
      return ctx.mode === "non-screen" ? "A long quiet stretch — normal for paper work" : "Little keyboard or mouse activity"
    case "typing rate":
      return "Your typing rhythm has changed"
    case "mouse activity":
      return "Your mouse activity has changed"
    case "last focus rating":
      return ctx.lastZ < 0 ? "Your last focus rating was low" : null
    case "reading-like motion":
    case "reading motion (paper)":
      // context evidence, not a cause of a drop — shown in model detail only
      return null
    // context encodings describe the session, not a cause
    case "screen session":
    case "typing (screen)":
    case "idle (screen)":
    case "screen gaze (screen)":
    case "desk gaze (paper)":
      return null
    default:
      return feature.charAt(0).toUpperCase() + feature.slice(1)
  }
}

interface Scored {
  session: SimSession
  avgFocus: number
  score: number
}

/** Demo alert level: the sixth-highest risk minus a small margin, so a session has a few warnings. */
function demoThreshold(risks: number[]) {
  const desc = [...risks].sort((a, b) => b - a)
  const six = desc[Math.min(5, desc.length - 1)] ?? 0.5
  return Math.round(Math.max(0.28, Math.min(0.55, six - 0.02)) * 100) / 100
}

/** When would the alert policy fire for a given risk trace? */
function alertTimes(risks: number[], threshold: number) {
  const times: number[] = []
  let last: number | null = null
  for (let i = 0; i < risks.length; i++) {
    if (risks[i] <= threshold || i < 3) continue
    if (last != null && i - last < 10) continue
    if (times.filter((t) => t > i - 60).length >= 3) continue
    times.push(i)
    last = i
  }
  return times
}

/**
 * Pick the session that makes the best demonstration: two or three alert moments,
 * the first one early enough to see, a mid-range focus profile, and a small number
 * of probe-confirmed dips. This is still a learner the models were not trained on.
 */
function chooseSession(study: { sessions: SimSession[] }, config: SessionConfig, models: Models): SimSession {
  const exact = study.sessions.filter((s) => s.task === config.task && s.room === config.place)
  const pool = exact.length ? exact : study.sessions.filter((s) => s.task === config.task)
  const candidates = pool.length ? pool : study.sessions

  const scored: Scored[] = candidates.slice(0, 18).map((session) => {
    const n = Math.min(config.minutes, session.epochs.length)
    const { map: zMap } = probeData(session, n)
    const feats = session.epochs.slice(0, n).map((e) =>
      toFeat(asC1(e), config.streams.c2 ? asC2(e, models.populationBand) : null, config.streams.c3 ? asC3(e) : null),
    )
    const risks: number[] = []
    const focuses: number[] = []
    for (let t = 0; t < n; t++) {
      const e = session.epochs[t]
      const out = scoreEpoch({
        models,
        c1: asC1(e),
        c2: config.streams.c2 ? asC2(e, models.populationBand) : null,
        c3: config.streams.c3 ? asC3(e) : null,
        window: feats.slice(Math.max(0, t - 3), t + 1),
        screen: session.mode === "screen",
        minutesOnTask: t,
        lastZ: lastZAt(zMap, t),
        epochIndex: t,
        epochMinutes: 1,
        alertsLastHour: 0,
        lastAlertIndex: null,
        policy: BASE_POLICY,
      })
      risks.push(out.risk)
      focuses.push(out.focusProb)
    }
    const avgFocus = Math.round((focuses.reduce((a, b) => a + b, 0) / focuses.length) * 100)
    const times = alertTimes(risks, demoThreshold(risks))
    const drops = session.probes.filter((p) => p.t < n && p.rating <= 2).length
    const alertScore = times.length >= 2 && times.length <= 3 ? 14 : times.length === 1 ? 6 : times.length > 3 ? 8 : 0
    const earlyScore = times.length === 0 ? 0 : times[0] <= 15 ? 8 : times[0] <= 25 ? 4 : 0
    const focusScore = Math.max(0, 10 - Math.abs(avgFocus - 66) / 4)
    const dropScore = drops === 0 ? 0 : drops <= 3 ? 6 : 2
    const riskScore = Math.max(...risks) > 0.55 ? 4 : 0
    return { session, avgFocus, score: alertScore + earlyScore + focusScore + dropScore + riskScore }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.session ?? candidates[0]
}

export function buildRun(student: Student, config: SessionConfig): DemoRun {
  const models: Models = getModels()
  const seed = 2026 + (hash(student.id + student.name) % 4000) + 1
  const study = generateStudy(seed, 22, 3)
  const session = chooseSession(study, config, models)
  const n = Math.min(config.minutes, session.epochs.length)
  const epochs = session.epochs.slice(0, n)
  const sm = stateModel(models)

  const feats = epochs.map((e) =>
    toFeat(asC1(e), config.streams.c2 ? asC2(e, models.populationBand) : null, config.streams.c3 ? asC3(e) : null),
  )

  // probes: a drop is a learner-normalised rating at or below −1
  const { map: probeZ, probes } = probeData(session, n)

  // First pass gives the risk trace that calibrates the demo alert policy;
  // the second pass then scores with that policy so counterfactuals match it.
  const preRisks = epochs.map((e, t) =>
    scoreEpoch({
      models,
      c1: asC1(e),
      c2: config.streams.c2 ? asC2(e, models.populationBand) : null,
      c3: config.streams.c3 ? asC3(e) : null,
      window: feats.slice(Math.max(0, t - 3), t + 1),
      screen: session.mode === "screen",
      minutesOnTask: t,
      lastZ: lastZAt(probeZ, t),
      epochIndex: t,
      epochMinutes: 1,
      alertsLastHour: 0,
      lastAlertIndex: null,
      policy: BASE_POLICY,
    }).risk,
  )
  const initialThreshold = demoThreshold(preRisks)

  const frames: Frame[] = epochs.map((e, t) => {
    const c1 = asC1(e)
    const c2 = config.streams.c2 ? asC2(e, models.populationBand) : null
    const c3 = config.streams.c3 ? asC3(e) : null
    const lastZ = lastZAt(probeZ, t)

    const out = scoreEpoch({
      models,
      c1,
      c2,
      c3,
      window: feats.slice(Math.max(0, t - 3), t + 1),
      screen: session.mode === "screen",
      minutesOnTask: t,
      lastZ,
      epochIndex: t,
      epochMinutes: 1,
      alertsLastHour: 0,
      lastAlertIndex: null,
      policy: { ...BASE_POLICY, threshold: initialThreshold },
    })

    const stateId = sm.assign([e.typingRate, e.idleRatio, e.mouseSpeed, e.switchRate])
    const reasons = [...new Set(
      out.contributions
        .map((c) => friendlyReason(c.feature, { c2, c3, minutesOnTask: t, mode: session.mode, lastZ }))
        .filter((r): r is string => !!r),
    )].slice(0, 3)
    if (!reasons.length) {
      reasons.push(
        session.mode === "non-screen"
          ? `A long unbroken reading stretch (${t} minutes)`
          : "A mix of small signals across the last few minutes",
      )
    }

    return {
      t,
      focusProb: out.focusProb,
      c1FocusProb: out.c1FocusProb,
      risk: out.risk,
      contributions: out.contributions,
      counterfactual: asPercent(out.counterfactual),
      fusion: out.fusion,
      streams: out.streams,
      stateId,
      stateLabel: sm.labels[stateId] ?? "Unknown",
      reasons,
      env: { temp: e.temp, humidity: e.humidity, light: e.light, noise: e.noise, motion: e.motion },
      vision: {
        zoneScreen: e.zoneScreen,
        zoneDesk: e.zoneDesk,
        zoneAway: e.zoneAway,
        phoneInFrame: e.phoneInFrame,
        readingMotion: e.readingMotion,
        validFace: e.validFace,
      },
      c1: {
        typingRate: e.typingRate,
        idleRatio: e.idleRatio,
        switchRate: e.switchRate,
        mouseSpeed: e.mouseSpeed,
        interKeyVar: e.interKeyVar,
        backspaceRatio: e.backspaceRatio,
        keyboardActive: e.keyboardActive,
      },
    }
  })

  return {
    id: `${student.id}-${Date.now()}`,
    studentId: student.id,
    studentName: student.name,
    createdAt: new Date().toISOString(),
    config: { ...config, minutes: n },
    mode: session.mode,
    frames,
    probes,
    participantCode: session.pid.toUpperCase(),
    modelSource: models.c1Source === "export" ? "research export" : "browser fallback",
    initialThreshold,
  }
}

/**
 * The alert policy runs live so "Helpful / Not now" can move the threshold.
 * An alert is raised only when risk crosses the learner's current level and the
 * budget/gap rules allow it.
 */
export function gateAlerts(
  run: DemoRun,
  upTo: number,
  policy: PolicyState,
  responses: Record<string, "helpful" | "not-now"> = {},
): RaisedAlert[] {
  const out: RaisedAlert[] = []
  let lastAlertT: number | null = null
  for (let i = 0; i <= Math.min(upTo, run.frames.length - 1); i++) {
    const f = run.frames[i]
    if (f.risk <= policy.threshold) continue
    if (i < 3) continue
    if (lastAlertT != null && i - lastAlertT < policy.minGapEpochs) continue
    if (out.filter((a) => a.t > i - 60).length >= policy.maxPerHour) continue
    const id = `a${i}`
    out.push({
      id,
      t: i,
      risk: f.risk,
      threshold: policy.threshold,
      reasons: f.reasons,
      counterfactual: f.counterfactual,
      contributions: f.contributions,
      fusion: f.fusion,
      streams: f.streams,
      response: responses[id] ?? null,
    })
    lastAlertT = i
  }
  return out
}
