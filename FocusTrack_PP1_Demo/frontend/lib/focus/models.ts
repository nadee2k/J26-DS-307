// Models used by the live pipeline. Until real FocusTrack data exist they are trained on the simulated study
// (lib/sim), which shares the live feature names and units. This is a prototype stand-in: the same code is
// retrained on real epochs and probes after data collection.

import { generateStudy } from "@/lib/sim/generate"
import { fitLogistic, kmeans, mean, predictLogistic, sd, standardizer, type Matrix } from "@/lib/sim/ml"
import type { Epoch, SimSession, SimStudy } from "@/lib/sim/types"
import type { ComfortBand } from "./c2"
import { c1BaselineRows, c1Rows, trainC1, trainC1Baseline } from "./c1-model"
import { fit, scoreLin, standardized, type LinModel } from "./linear"
import c1Export from "../../public/models/c1.json"

export { c1Vec, c1BaselineVec, C1_NAMES, C1_BASELINE_NAMES } from "./c1-model"
export { scoreLin, standardized, type LinModel } from "./linear"

export type Avail = { c2: boolean; c3: boolean }
export type Feat = { typingRate: number; idleRatio: number; switchRate: number; mouseSpeed: number; interKeyVar: number; backspaceRatio: number; noise: number; temp: number; zoneScreen: number; zoneDesk: number; zoneAway: number; readingMotion: number; phoneInFrame: number }

// ---------- feature vectors (shared by training and live scoring) ----------
export const FOCUS_NAMES = ["typing rate", "idle time", "app switching", "mouse activity", "noise", "temperature", "looking at screen", "looking at desk", "looking away", "reading-like motion", "phone in frame", "screen session", "typing (screen)", "idle (screen)", "screen gaze (screen)", "desk gaze (paper)", "reading motion (paper)"]
export function focusVec(f: Feat, screen: boolean, a: Avail) {
  const s = screen ? 1 : 0
  const v = a.c3 ? [f.zoneScreen, f.zoneDesk, f.zoneAway, f.readingMotion, f.phoneInFrame] : [0, 0, 0, 0, 0]
  return [f.typingRate, f.idleRatio, f.switchRate, f.mouseSpeed / 100, a.c2 ? f.noise : 0, a.c2 ? f.temp : 0, ...v, s, s * f.typingRate, s * f.idleRatio, s * v[0], (1 - s) * v[1], (1 - s) * v[3]]
}
export const RISK_NAMES = ["typing rate", "idle time", "app switching", "noise", "temperature", "looking away", "phone in frame", "reading-like motion", "time on task (min)", "last focus rating", "screen session", "typing (screen)", "idle (screen)", "reading motion (paper)"]
export const RISK_CHANGEABLE = [false, false, true, true, true, true, true, false, true, false, false, false, false, false]
/** Risk features: mean of the last (up to) 4 epochs + time on task + last probe (z) + study-mode context. */
export function riskVec(win: Feat[], minutes: number, lastZ: number, screen: boolean, a: Avail) {
  const m = (k: keyof Feat) => win.reduce((s, e) => s + e[k], 0) / Math.max(1, win.length)
  const s = screen ? 1 : 0
  const v = [m("typingRate"), m("idleRatio"), m("switchRate"), a.c2 ? m("noise") : 0, a.c2 ? m("temp") : 0,
    a.c3 ? m("zoneAway") : 0, a.c3 ? m("phoneInFrame") : 0, a.c3 ? m("readingMotion") : 0, minutes, lastZ, s]
  v.push(s * v[0], s * v[1], (1 - s) * v[7])
  return v
}

const simFeat = (e: Epoch): Feat => ({ typingRate: e.typingRate, idleRatio: e.idleRatio, switchRate: e.switchRate, mouseSpeed: e.mouseSpeed, interKeyVar: e.interKeyVar, backspaceRatio: e.backspaceRatio, noise: e.noise, temp: e.temp, zoneScreen: e.zoneScreen, zoneDesk: e.zoneDesk, zoneAway: e.zoneAway, readingMotion: e.readingMotion, phoneInFrame: e.phoneInFrame })

function zFn(study: SimStudy) {
  const stats = new Map<string, { m: number; s: number }>()
  for (const p of study.participants) {
    const r = study.sessions.filter((s) => s.pid === p.id).flatMap((s) => s.probes.map((x) => x.rating))
    // a learner with no probes (or no variance) gets a unit scale, never a NaN
    const s = r.length ? Math.max(sd(r), 0.5) : 1
    stats.set(p.id, { m: mean(r), s })
  }
  return (pid: string, rating: number) => { const st = stats.get(pid) ?? { m: 0, s: 1 }; return (rating - st.m) / st.s }
}

/** Learner-normalised probe ratings, shared by training, evaluation and the model check. */
export function participantZ(study: SimStudy) {
  return zFn(study)
}

export interface Models {
  focus: Record<string, LinModel> // key "c2c3" availability, e.g. "11", "10", "01", "00"
  c1: LinModel
  /** Simple activity-count baseline, trained on the same rows and smoothing as `c1`. */
  c1Baseline: LinModel
  risk: Record<string, LinModel>
  states: { centroids: number[][]; mu: number[]; sg: number[]; labels: string[] }
  populationBand: ComfortBand
  trainedOn: string
  /** Where the live C1 score comes from: the research export or the browser fallback. */
  c1Source: "export" | "browser"
  c1TrainedOn: string
}
export const availKey = (a: Avail) => `${a.c2 ? 1 : 0}${a.c3 ? 1 : 0}`

function isLinModel(value: unknown): value is LinModel {
  if (!value || typeof value !== "object") return false
  const model = value as Partial<LinModel>
  return (
    Array.isArray(model.w) &&
    Array.isArray(model.mu) &&
    Array.isArray(model.sg) &&
    Array.isArray(model.names) &&
    model.w.length === model.names.length + 1 &&
    model.mu.length === model.names.length &&
    model.sg.length === model.names.length
  )
}

/** Model exported by research/scripts/export_web_model.py (null if the artifact is absent or malformed). */
const exportedC1: LinModel | null = isLinModel((c1Export as { model?: unknown }).model)
  ? ((c1Export as { model: LinModel }).model)
  : null
const exportedC1TrainedOn =
  exportedC1 && typeof (c1Export as { trainedOn?: unknown }).trainedOn === "string"
    ? (c1Export as { trainedOn: string }).trainedOn
    : "research export"

let cache: Models | null = null

export function getModels(): Models {
  if (cache) return cache
  const study = generateStudy(2026)
  const z = zFn(study)
  const labelled: { s: SimSession; e: Epoch; f: Feat; y: number }[] = []
  const riskRows: { s: SimSession; t0: number; lastZ: number; y: number; win: Feat[] }[] = []
  for (const s of study.sessions) {
    let lastZ = 0
    for (const pr of s.probes) {
      const zz = z(s.pid, pr.rating)
      for (let t = Math.max(0, pr.t - 5); t < pr.t; t++) {
        const e = s.epochs[t]
        labelled.push({ s, e, f: simFeat(e), y: zz > 0 ? 1 : 0 })
      }
      for (let t0 = Math.max(0, pr.t - 10); t0 <= pr.t - 5; t0++) {
        riskRows.push({ s, t0, lastZ, y: zz <= -1 ? 1 : 0, win: s.epochs.slice(Math.max(0, t0 - 3), t0 + 1).map(simFeat) })
      }
      lastZ = zz
    }
  }
  const avails: Avail[] = [{ c2: true, c3: true }, { c2: true, c3: false }, { c2: false, c3: true }, { c2: false, c3: false }]
  const focus: Record<string, LinModel> = {}, risk: Record<string, LinModel> = {}
  for (const a of avails) {
    focus[availKey(a)] = fit(labelled.map((r) => focusVec(r.f, r.s.mode === "screen", a)), labelled.map((r) => r.y), FOCUS_NAMES)
    risk[availKey(a)] = fit(
      riskRows.map((r) => riskVec(r.win, r.t0, r.lastZ, r.s.mode === "screen", a)),
      riskRows.map((r) => r.y), RISK_NAMES)
  }
  const c1 = exportedC1 ?? trainC1(c1Rows(study, z))
  const c1Baseline = trainC1Baseline(c1BaselineRows(study, z))

  // interaction states: k-means (k = 4) on standardised raw interaction features; the final system uses a Gaussian HMM
  const raw = study.sessions.flatMap((s) => s.epochs.filter((_, i) => i % 3 === 0).map((e) => [e.typingRate, e.idleRatio, e.mouseSpeed, e.switchRate]))
  const st = standardizer(raw)
  const km = kmeans(st.apply(raw), 4, 30)
  // km.centroids already live in standardised space; unstandardise once for the interpretable labels
  while (km.centroids.length < 4) km.centroids.push([...km.centroids[0]])
  const centroids = km.centroids
  const rawCent = centroids.map((c) => c.map((v, j) => v * st.sg[j] + st.mu[j]))
  const labels = ["", "", "", ""]
  const order = [0, 1, 2, 3]
  const typing = [...order].sort((a, b) => rawCent[b][0] - rawCent[a][0])[0]
  const switching = [...order].filter((k) => k !== typing).sort((a, b) => rawCent[b][3] - rawCent[a][3])[0]
  const rest = order.filter((k) => k !== typing && k !== switching).sort((a, b) => rawCent[b][2] - rawCent[a][2])
  // names describe each cluster centre: typing, leaving the app with little activity, browsing/watching, idle
  labels[typing] = "Sustained typing"; labels[switching] = "Leaving the app often"; labels[rest[0]] = "Browsing / watching on screen"; labels[rest[1]] = "Idle / away from the computer"

  const q = (xs: number[], p: number) => {
    if (!xs.length) return NaN
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]
  }
  const good = labelled.filter((r) => r.y === 1).map((r) => r.e)
  const bandRows = good.length ? good : labelled.map((r) => r.e) // fall back to all epochs if no focused ones
  cache = {
    focus, c1, c1Baseline, risk,
    states: { centroids, mu: st.mu, sg: st.sg, labels },
    populationBand: { noise: [q(bandRows.map((e) => e.noise), 0.1), q(bandRows.map((e) => e.noise), 0.9)], temp: [q(bandRows.map((e) => e.temp), 0.1), q(bandRows.map((e) => e.temp), 0.9)], personal: false, basis: good.length },
    trainedOn: `simulated study (seed 2026, ${study.participants.length} participants, ${labelled.length} labelled epochs)`,
    c1Source: exportedC1 ? "export" : "browser",
    c1TrainedOn: exportedC1
      ? exportedC1TrainedOn
      : `simulated study (seed 2026, ${study.participants.length} participants, ${labelled.length} labelled epochs)`,
  }
  return cache
}

export function stateModel(m: Models) {
  return {
    labels: m.states.labels,
    assign: (raw: number[]) => {
      if (!m.states.centroids.length) return 0
      const x = raw.map((v, j) => (v - m.states.mu[j]) / m.states.sg[j])
      let best = 0, bd = Infinity
      m.states.centroids.forEach((c, k) => { const d = c.reduce((s, v, j) => s + (v - x[j]) ** 2, 0); if (d < bd) { bd = d; best = k } })
      return best
    },
  }
}
