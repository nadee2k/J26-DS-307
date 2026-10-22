// Component 1 – the concentration model built from keyboard, mouse and app-switching features only.
// Trained rows come from the simulated study until real epochs and probes exist.

import { accuracy, macroF1, mean, rocAuc } from "../sim/ml"
import type { SimStudy } from "../sim/types"
import { fit, scoreLin, type LinModel } from "./linear"

export interface C1Input {
  typingRate: number
  interKeyVar: number
  backspaceRatio: number
  idleRatio: number
  mouseSpeed: number
  switchRate: number
}

export const C1_NAMES = ["typing rate", "idle time", "app switching", "mouse activity", "typing rhythm variability", "corrections", "screen session", "typing (screen)", "idle (screen)", "switching (screen)"]

/** The simple activity-count baseline: no states, transitions or context interactions. */
export const C1_BASELINE_NAMES = ["typing rate", "idle time", "mouse speed", "app switching"]

export function c1BaselineVec(f: C1Input) {
  return [f.typingRate, f.idleRatio, f.mouseSpeed, f.switchRate]
}

export function c1Vec(f: C1Input, screen: boolean) {
  const s = screen ? 1 : 0
  return [f.typingRate, f.idleRatio, f.switchRate, f.mouseSpeed / 100, f.interKeyVar, f.backspaceRatio, s, s * f.typingRate, s * f.idleRatio, s * f.switchRate]
}

export interface C1Row { pid: string; x: number[]; y: number }

/** Number of recent epochs averaged into one C1 reading (used identically in training and live). */
export const C1_WINDOW = 5

/** Mean of the most recent C1_WINDOW epochs; `history` ends with the current epoch. */
export function c1Smooth(history: C1Input[]): C1Input {
  const win = history.slice(-C1_WINDOW)
  const avg = (k: keyof C1Input) => mean(win.map((e) => e[k]))
  return { typingRate: avg("typingRate"), interKeyVar: avg("interKeyVar"), backspaceRatio: avg("backspaceRatio"), idleRatio: avg("idleRatio"), mouseSpeed: avg("mouseSpeed"), switchRate: avg("switchRate") }
}

/** The 5 epochs before each probe; label 1 when the learner's rating is above their own average. */
function c1RowsWith(study: SimStudy, z: (pid: string, rating: number) => number, vec: (f: C1Input, screen: boolean) => number[]): C1Row[] {
  const rows: C1Row[] = []
  for (const s of study.sessions) {
    for (const pr of s.probes) {
      const y = z(s.pid, pr.rating) > 0 ? 1 : 0
      for (let t = Math.max(0, pr.t - 5); t < pr.t; t++) {
        rows.push({ pid: s.pid, x: vec(c1Smooth(s.epochs.slice(0, t + 1)), s.mode === "screen"), y })
      }
    }
  }
  return rows
}

export function c1Rows(study: SimStudy, z: (pid: string, rating: number) => number): C1Row[] {
  return c1RowsWith(study, z, c1Vec)
}

/** The same rows and smoothing, but with the simple activity-count vector used as the baseline. */
export function c1BaselineRows(study: SimStudy, z: (pid: string, rating: number) => number): C1Row[] {
  return c1RowsWith(study, z, (f) => c1BaselineVec(f))
}

export function trainC1(rows: C1Row[], opts: { iters?: number; l2?: number } = {}): LinModel {
  return fit(rows.map((r) => r.x), rows.map((r) => r.y), C1_NAMES, opts)
}

export function trainC1Baseline(rows: C1Row[], opts: { iters?: number; l2?: number } = {}): LinModel {
  return fit(rows.map((r) => r.x), rows.map((r) => r.y), C1_BASELINE_NAMES, opts)
}

/** Participant-grouped k-fold: no participant appears in both the training and the test fold. */
export function evaluateC1(rows: C1Row[], folds = 5, opts: { iters?: number; l2?: number } = {}) {
  const posRate = new Map<string, number[]>()
  for (const r of rows) posRate.set(r.pid, [...(posRate.get(r.pid) ?? []), r.y])
  // deal participants round-robin in order of their positive rate, so every fold gets a similar mix
  const order = [...posRate.keys()].sort((a, b) => mean(posRate.get(a)!) - mean(posRate.get(b)!) || (a < b ? -1 : 1))
  const fold = new Map(order.map((pid, i) => [pid, i % folds]))
  const out = []
  for (let k = 0; k < folds; k++) {
    const train = rows.filter((r) => fold.get(r.pid) !== k)
    const test = rows.filter((r) => fold.get(r.pid) === k)
    if (!train.length || !test.length) continue
    const m = trainC1(train, opts)
    const scores = test.map((r) => scoreLin(m, r.x))
    const y = test.map((r) => r.y)
    const pred = scores.map((s) => (s >= 0.5 ? 1 : 0))
    const majority = mean(train.map((r) => r.y)) >= 0.5 ? 1 : 0
    out.push({
      fold: k,
      participants: new Set(test.map((r) => r.pid)).size,
      rows: test.length,
      accuracy: accuracy(y, pred),
      macroF1: macroF1(y, pred),
      auc: rocAuc(y, scores),
      baselineAccuracy: accuracy(y, y.map(() => majority)),
    })
  }
  return out
}
