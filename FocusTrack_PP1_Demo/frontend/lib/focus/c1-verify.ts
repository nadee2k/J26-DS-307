// Checks for the C1 demo output:
// 1. reproduce the stored scores from the trained C1 weights (c1-check),
// 2. explain the latest score with feature contributions (c1-check),
// 3. compare C1 with the simple activity baseline and the C4 fusion model,
// 4. evaluate the exact live C1 model with participant-grouped folds on the simulated study.

import { generateStudy } from "../sim/generate"
import { c1BaselineVec, c1Rows, c1Smooth, c1Vec, evaluateC1 } from "./c1-model"
import { scoreEpoch, toFeat } from "./c4"
import { scoreLin } from "./linear"
import { participantZ, type Models } from "./models"
import type { StudyMode } from "./types"
import type { EpochForCheck } from "./c1-check"

export { recomputeC1Scores, verifyC1Scores, scoreContributions, contributionText } from "./c1-check"
export type { EpochForCheck, ScoreCheck, ScoreContribution } from "./c1-check"

export interface ModelComparison {
  baseline: number
  c1: number
  c4: number
  c4C1: number | null
}

/** Compare the live C1 score with the activity-count baseline and the C4 fusion model (C1 stream only). */
export function compareModelsForEpoch(epochs: EpochForCheck[], models: Models, mode: StudyMode, epochSec: number): ModelComparison | null {
  if (!epochs.length) return null
  const smooth = c1Smooth(epochs.map((e) => e.f))
  const screen = mode === "screen"
  const c1 = scoreLin(models.c1, c1Vec(smooth, screen))
  const baseline = scoreLin(models.c1Baseline, c1BaselineVec(smooth))
  // Give C4 the same smoothed behaviour vector so the comparison is like-for-like.
  const latest = { ...epochs[epochs.length - 1].f, ...smooth }
  const out = scoreEpoch({
    models,
    c1: latest,
    c2: null,
    c3: null,
    window: epochs.slice(-4).map((e) => toFeat(e.f, null, null)),
    screen,
    minutesOnTask: (epochs.length * epochSec) / 60,
    lastZ: 0,
    epochIndex: epochs.length,
    epochMinutes: epochSec / 60,
    alertsLastHour: 0,
    lastAlertIndex: null,
    policy: { threshold: 0.5, maxPerHour: 4, showAlerts: false, minGapEpochs: 3 },
  })
  return { baseline, c1, c4: out.focusProb, c4C1: out.c1FocusProb }
}

export interface HoldoutFold {
  fold: number
  participants: number
  rows: number
  accuracy: number
  macroF1: number
  auc: number
  baselineAccuracy: number
}

export interface HoldoutResult {
  folds: HoldoutFold[]
  accuracy: number
  macroF1: number
  auc: number
  baselineAccuracy: number
  rows: number
  participants: number
  trainedOn: string
}

const finiteMean = (xs: number[]) => {
  const values = xs.filter(Number.isFinite)
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN
}

let holdoutCache: HoldoutResult | null = null

/**
 * Participant-grouped 5-fold check of the exact live C1 model on the simulated study.
 * This is simulator evidence, not real-world accuracy.
 */
export function evaluateC1OnSimulatedStudy(): HoldoutResult {
  if (holdoutCache) return holdoutCache
  const study = generateStudy(2026)
  const z = participantZ(study)
  const rows = c1Rows(study, z)
  const folds = evaluateC1(rows, 5).map((f) => ({
    fold: f.fold,
    participants: f.participants,
    rows: f.rows,
    accuracy: f.accuracy,
    macroF1: f.macroF1,
    auc: f.auc,
    baselineAccuracy: f.baselineAccuracy,
  }))
  holdoutCache = {
    folds,
    accuracy: finiteMean(folds.map((f) => f.accuracy)),
    macroF1: finiteMean(folds.map((f) => f.macroF1)),
    auc: finiteMean(folds.map((f) => f.auc)),
    baselineAccuracy: finiteMean(folds.map((f) => f.baselineAccuracy)),
    rows: rows.length,
    participants: new Set(rows.map((r) => r.pid)).size,
    trainedOn: "simulated study (seed 2026)",
  }
  return holdoutCache
}

/** Snapshot used by the export and the standalone verification script. */
export function c1ModelSnapshot(models: Models) {
  return {
    c1: models.c1,
    baseline: models.c1Baseline,
    focus00: models.focus["00"],
    trainedOn: models.trainedOn,
  }
}
