// Component 4 – fused focus estimate, focus-drop forecast, personal alert policy and explanations.

import { availKey, c1Vec, focusVec, riskVec, RISK_CHANGEABLE, RISK_NAMES, scoreLin, standardized, type Avail, type Feat, type Models } from "./models"
import type { C1Features, C2Features, C3Features, C4Output, Contribution } from "./types"

export function toFeat(c1: C1Features | null, c2: C2Features | null, c3: C3Features | null): Feat {
  return {
    typingRate: c1?.typingRate ?? 0, idleRatio: c1?.idleRatio ?? 1, switchRate: c1?.switchRate ?? 0, mouseSpeed: c1?.mouseSpeed ?? 0,
    interKeyVar: c1?.interKeyVar ?? 0.5, backspaceRatio: c1?.backspaceRatio ?? 0,
    noise: c2?.noise ?? 0, temp: c2?.temp ?? 0,
    zoneScreen: c3?.zoneScreen ?? 0, zoneDesk: c3?.zoneDesk ?? 0, zoneAway: c3?.zoneAway ?? 0,
    readingMotion: c3?.readingMotion ?? 0, phoneInFrame: c3?.phoneInFrame ?? 0,
  }
}

export const availability = (c2: C2Features | null, c3: C3Features | null): Avail => ({
  c2: !!c2 && c2.noise != null && c2.temp != null,
  c3: !!c3 && c3.validFace >= 0.3,
})

/** Learner-normalised probe rating with shrinkage towards the population (mean 3, SD 1) while there are few probes. */
export function zOf(rating: number, history: number[]) {
  const n = history.length, k = 5
  const m0 = n ? history.reduce((a, b) => a + b, 0) / n : 3
  const v0 = n ? history.reduce((a, b) => a + (b - m0) ** 2, 0) / n : 1
  const m = (n * m0 + k * 3) / (n + k)
  const s = Math.sqrt((n * v0 + k * 1) / (n + k)) || 1
  return (rating - m) / s
}

export interface PolicyState {
  threshold: number
  maxPerHour: number
  showAlerts: boolean // phase 2 (intervention); in phase 1 alerts are logged but never shown
  minGapEpochs: number
}

export interface ScoreInput {
  models: Models
  c1: C1Features | null; c2: C2Features | null; c3: C3Features | null
  window: Feat[] // features of this and up to 3 previous epochs (oldest first)
  screen: boolean
  minutesSinceBreak: number
  lastZ: number
  epochIndex: number
  epochMinutes: number // minutes per epoch (1, or 0.25 in fast demo)
  alertsLastHour: number
  lastAlertIndex: number | null
  policy: PolicyState
}

const TRIES: { label: string; set: Partial<Record<number, number>> }[] = [
  { label: "move somewhere quieter", set: { 3: 45 } },
  { label: "put your phone away", set: { 6: 0 } },
  { label: "take a 5-minute break", set: { 8: 0 } },
  { label: "close the apps you keep switching to", set: { 2: 0.5 } },
  { label: "put your phone away and take a short break", set: { 6: 0, 8: 0 } },
  { label: "move somewhere quieter and take a short break", set: { 3: 45, 8: 0 } },
]

export function scoreEpoch(inp: ScoreInput): C4Output {
  const a = availability(inp.c2, inp.c3)
  const f = toFeat(inp.c1, inp.c2, inp.c3)
  const focusModel = inp.models.focus[availKey(a)]
  const focusProb = scoreLin(focusModel, focusVec(f, inp.screen, a))
  const c1FocusProb = inp.c1 ? scoreLin(inp.models.c1, c1Vec(f, inp.screen)) : null
  const rm = inp.models.risk[availKey(a)]
  const x = riskVec(inp.window, inp.minutesSinceBreak, inp.lastZ, inp.screen, a)
  const risk = scoreLin(rm, x)
  const xs = standardized(rm, x)
  // same signal, different meaning: low typing and idle keyboard are expected when reading or writing on paper,
  // so they are never given as a reason in non-screen sessions
  const notMeaningful = inp.screen ? [] : ["typing rate", "idle time", "typing (screen)", "idle (screen)"]
  const contributions: Contribution[] = RISK_NAMES.map((name, j) => ({ feature: name, value: rm.w[j + 1] * xs[j], changeable: RISK_CHANGEABLE[j] }))
    .filter((c) => c.value > 0.05 && !notMeaningful.includes(c.feature)).sort((p, q) => q.value - p.value).slice(0, 3)
  const th = inp.policy.threshold
  let counterfactual: string | null = null
  if (risk > th) {
    for (const t of TRIES) {
      if ((3 in t.set && !a.c2) || (6 in t.set && !a.c3)) continue // only suggest changes we can observe
      const x2 = [...x]
      for (const [j, v] of Object.entries(t.set)) x2[Number(j)] = v as number
      x2[11] = x2[10] * x2[0]; x2[12] = x2[10] * x2[1]; x2[13] = (1 - x2[10]) * x2[7]
      const r2 = scoreLin(rm, x2)
      if (r2 < th - 0.03) { counterfactual = `Try to ${t.label}: the predicted risk falls from ${risk.toFixed(2)} to ${r2.toFixed(2)} (your alert level is ${th.toFixed(2)}).`; break }
    }
  }
  // alert policy: needs a few epochs of history, respects the hourly budget and a minimum gap between alerts
  let alert = false, alertSuppressed: string | null = null
  const minEpochs = Math.ceil(3 / inp.epochMinutes)
  if (risk > th) {
    if (inp.epochIndex < Math.min(minEpochs, 3)) alertSuppressed = "not enough history yet"
    else if (inp.lastAlertIndex != null && inp.epochIndex - inp.lastAlertIndex < inp.policy.minGapEpochs) alertSuppressed = "too soon after the last alert"
    else if (inp.alertsLastHour >= inp.policy.maxPerHour) alertSuppressed = "hourly alert limit reached"
    else alert = true
  }
  return {
    focusProb, c1FocusProb, risk, threshold: th,
    fusion: a.c2 && a.c3 ? "feature-level" : "decision-level",
    streams: { c1: !!inp.c1, c2: a.c2, c3: a.c3 },
    contributions, counterfactual, alert, alertSuppressed,
  }
}

/** Plain-language reasons from the top contributions. */
export function reasonText(c: Contribution, ctx: { c2: C2Features | null; c3: C3Features | null; minutesSinceBreak: number }) {
  switch (c.feature) {
    case "noise": return ctx.c2?.noise != null ? `Noise is about ${Math.round(ctx.c2.noise)} dB${ctx.c2.comfortNoise > 0 ? ", above your comfort range" : ""}` : "Noise level"
    case "temperature": return ctx.c2?.temp != null ? `Room temperature is ${ctx.c2.temp.toFixed(1)} °C${ctx.c2.comfortTemp > 0 ? ", outside your comfort range" : ""}` : "Room temperature"
    case "minutes since break": return `${Math.round(ctx.minutesSinceBreak)} minutes since your last break`
    case "phone in frame": return "Your phone has been in view"
    case "looking away": return "You have been looking away from your work"
    case "app switching": return "You have been switching between apps"
    case "idle time": return "Little keyboard or mouse activity"
    case "last focus rating": return "Your last focus rating was low"
    default: return c.feature.charAt(0).toUpperCase() + c.feature.slice(1)
  }
}

/** Prototype feedback rule (phase 2 replaces it with Bayesian optimisation over the pooled prior). */
export function updateThreshold(th: number, response: "helpful" | "not-now") {
  return response === "helpful" ? Math.max(0.3, th - 0.02) : Math.min(0.9, th + 0.05)
}
