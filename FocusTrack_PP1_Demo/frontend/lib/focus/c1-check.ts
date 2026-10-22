// Pure checks for the C1 demo output: reproduce the stored score from the trained weights
// and explain the latest score. Kept separate from the heavier simulated-study evaluation
// so it can be unit-tested without the simulator/Next.js aliases.

import { c1Smooth, c1Vec } from "./c1-model"
import { scoreLin, standardized, type LinModel } from "./linear"
import type { C1Features } from "./types"

export interface EpochForCheck {
  f: C1Features
  p: number
  at?: string
  app?: string | null
}

export interface ScoreCheck {
  count: number
  ok: boolean
  maxDiff: number
  mismatches: { index: number; stored: number; expected: number }[]
  expected: number[]
}

/** Recompute the exact live score for every epoch, using the same 5-epoch smoothing and feature vector. */
export function recomputeC1Scores(epochs: EpochForCheck[], model: LinModel, screen: boolean): number[] {
  if (!epochs.length) return []
  const inputs = epochs.map((e) => e.f)
  return inputs.map((_, i) => scoreLin(model, c1Vec(c1Smooth(inputs.slice(0, i + 1)), screen)))
}

/** Verify that the displayed scores are reproducible from the trained model. */
export function verifyC1Scores(epochs: EpochForCheck[], model: LinModel, screen: boolean, tolerance = 1e-9): ScoreCheck {
  const expected = recomputeC1Scores(epochs, model, screen)
  const mismatches = epochs
    .map((e, i) => ({ index: i, stored: Number.isFinite(e.p) ? e.p : NaN, expected: expected[i] }))
    .filter((d) => !Number.isFinite(d.stored) || Math.abs(d.stored - d.expected) > tolerance)
  const maxDiff = expected.length
    ? expected.reduce((m, p, i) => Math.max(m, Number.isFinite(epochs[i]?.p) ? Math.abs(p - epochs[i].p) : Infinity), 0)
    : 0
  return { count: epochs.length, ok: mismatches.length === 0, maxDiff, mismatches, expected }
}

const FEATURE_LABELS: Record<string, string> = {
  "typing rate": "typing activity",
  "idle time": "quiet time",
  "app switching": "app switching",
  "mouse activity": "mouse activity",
  "typing rhythm variability": "typing rhythm",
  corrections: "corrections",
  "screen session": "screen work",
  "typing (screen)": "typing on screen",
  "idle (screen)": "quiet time on screen",
  "switching (screen)": "switching while on screen",
}

export interface ScoreContribution {
  feature: string
  label: string
  /** Positive pushes the focus score up; negative pulls it down (logit scale). */
  contribution: number
  direction: "helps" | "hurts"
}

export function scoreContributions(epochs: EpochForCheck[], model: LinModel, screen: boolean) {
  if (!epochs.length) return { bias: Number.isFinite(model.w[0]) ? model.w[0] : 0, contributions: [] as ScoreContribution[] }
  const smooth = c1Smooth(epochs.map((e) => e.f))
  const z = standardized(model, c1Vec(smooth, screen))
  const contributions: ScoreContribution[] = model.names
    .map((feature, j) => {
      const contribution = (Number.isFinite(model.w[j + 1]) ? model.w[j + 1] : 0) * (Number.isFinite(z[j]) ? z[j] : 0)
      return { feature, label: FEATURE_LABELS[feature] ?? feature, contribution, direction: contribution >= 0 ? "helps" as const : "hurts" as const }
    })
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
  return { bias: Number.isFinite(model.w[0]) ? model.w[0] : 0, contributions }
}

/** Plain-language sentence for one contribution. */
export function contributionText(c: ScoreContribution): string {
  const helps = c.direction === "helps"
  switch (c.feature) {
    case "typing rate": return helps ? "Typing activity is helping" : "Very little typing is pulling focus down"
    case "idle time": return helps ? "Low quiet time is helping" : "Long quiet time is pulling focus down"
    case "app switching": return helps ? "Few app switches is helping" : "Frequent app switching is pulling focus down"
    case "mouse activity": return helps ? "Mouse activity is helping" : "Very little mouse activity is pulling focus down"
    case "typing rhythm variability": return helps ? "A steady typing rhythm is helping" : "An uneven typing rhythm is pulling focus down"
    case "corrections": return helps ? "Few corrections is helping" : "Lots of corrections is pulling focus down"
    case "screen session": return helps ? "The screen-work context is helping" : "The screen-work context is pulling focus down"
    case "typing (screen)": return helps ? "Typing while on screen is helping" : "Little typing on screen is pulling focus down"
    case "idle (screen)": return helps ? "Low idle time on screen is helping" : "Long idle time on screen is pulling focus down"
    case "switching (screen)": return helps ? "Few switches on screen is helping" : "Switching while on screen is pulling focus down"
    default: return `${c.label} is ${helps ? "helping" : "pulling focus down"}`
  }
}
