// Component 3 – per-frame Downward-Gaze Disambiguation (DGD) and per-epoch visual features.
// DGD follows the decision flow in the proposal: head down? → phone in frame? → desk anchor + reading-like
// motion? → screen session with keyboard activity? → otherwise "looking down – possible phone out of frame".

import type { FrameFeatures } from "./buffers"
import type { C3Features, DgdState, StudyMode } from "./types"
import { fixedZone } from "./vision-math"

export interface DgdContext {
  mode: StudyMode
  deskAnchor: number | null // mean pitch while looking at the desk during calibration
  screenPitch: number | null
  keyboardActive: boolean // C1: keys pressed in the last few seconds
  readingNow: boolean // reading-like motion in the last ~10 s
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) }

/** Is the head pitched down towards the desk? Uses the learner's own calibration when available. */
export function isDown(f: FrameFeatures, ctx: Pick<DgdContext, "deskAnchor" | "screenPitch">) {
  if (f.zone === 1) return true
  if (f.zone === 0 || f.zone === 2) return false
  const cut = ctx.deskAnchor != null && ctx.screenPitch != null ? (ctx.deskAnchor + ctx.screenPitch) / 2 : 15
  return f.pitch > cut
}

export function dgdFrame(f: FrameFeatures, ctx: DgdContext): DgdState {
  if (!f.face) return "no-face"
  if (f.phone) return "phone"
  if (!isDown(f, ctx)) return f.zone === 2 || (f.zone === -1 && fixedZone(f.pitch, f.yaw) === 2) ? "away" : "screen"
  const anchorMatch = ctx.deskAnchor == null ? true : Math.abs(f.pitch - ctx.deskAnchor) < 12
  if (anchorMatch && ctx.readingNow) return "reading"
  if (ctx.mode === "screen" && ctx.keyboardActive) return "typing"
  return "unclear"
}

/**
 * Reading-like head motion in a short window (≈10 s): the face is visible, the head stays near the desk,
 * and the eyes/head make small, repeated horizontal sweeps (line by line), not still and not large turns.
 */
export function readingLike(frames: FrameFeatures[], ctx: Pick<DgdContext, "deskAnchor" | "screenPitch">) {
  const F = frames.filter((f) => f.face)
  if (F.length < 6 || F.length < frames.length * 0.7) return false
  if (F.filter((f) => isDown(f, ctx)).length < F.length * 0.6) return false
  const ys = sd(F.map((f) => f.yaw))
  if (ys < 0.4 || ys > 8) return false
  // direction reversals of the smoothed horizontal iris position
  const xs = F.map((f) => f.irisX)
  const sm = xs.map((_, i) => mean(xs.slice(Math.max(0, i - 1), i + 2)))
  let rev = 0, dir = 0, ext = sm[0]
  for (let i = 1; i < sm.length; i++) {
    const delta = sm[i] - ext
    if (dir >= 0 && delta < -0.04) { if (dir > 0) rev++; dir = -1; ext = sm[i] }
    else if (dir <= 0 && delta > 0.04) { if (dir < 0) rev++; dir = 1; ext = sm[i] }
    else if ((dir > 0 && sm[i] > ext) || (dir < 0 && sm[i] < ext)) ext = sm[i]
  }
  return rev >= 2
}

/** Share of ~10-second windows in the epoch that look like reading. */
export function readingMotionScore(frames: FrameFeatures[], ctx: Pick<DgdContext, "deskAnchor" | "screenPitch">) {
  if (!frames.length) return 0
  const t0 = frames[0].t, t1 = frames[frames.length - 1].t
  let windows = 0, hits = 0
  for (let s = t0; s < t1; s += 10000) {
    const w = frames.filter((f) => f.t >= s && f.t < s + 10000)
    if (w.length < 4) continue
    windows++
    if (readingLike(w, ctx)) hits++
  }
  return windows ? hits / windows : 0
}

export function aggregateC3(frames: FrameFeatures[], states: DgdState[], ctx: Pick<DgdContext, "deskAnchor" | "screenPitch">, personalModel: boolean): C3Features | null {
  if (frames.length < 3) return null
  const F = frames.filter((f) => f.face)
  const zoned = F.map((f) => (f.zone >= 0 ? f.zone : fixedZone(f.pitch, f.yaw)))
  const share = (z: number) => (zoned.length ? zoned.filter((v) => v === z).length / zoned.length : 0)
  const checked = frames.filter((f) => f.phone !== null)
  const all: DgdState[] = ["screen", "reading", "typing", "phone", "away", "unclear", "no-face"]
  const dgdShares = Object.fromEntries(all.map((s) => [s, states.length ? states.filter((v) => v === s).length / states.length : 0])) as Record<DgdState, number>
  // the epoch's state: the most common state among frames with a face (no-face only if nothing else was seen)
  const withFace = all.filter((s) => s !== "no-face")
  let dgdState: DgdState = "no-face"
  let best = 0
  for (const s of withFace) if (dgdShares[s] > best) { best = dgdShares[s]; dgdState = s }
  return {
    pitchMean: mean(F.map((f) => f.pitch)),
    yawStd: sd(F.map((f) => f.yaw)),
    zoneScreen: share(0), zoneDesk: share(1), zoneAway: share(2),
    readingMotion: readingMotionScore(frames, ctx),
    phoneInFrame: checked.length ? checked.filter((f) => f.phone).length / checked.length : 0,
    validFace: F.length / frames.length,
    glare: mean(F.map((f) => f.glare)),
    lowLight: frames.filter((f) => f.luminance < 50).length / frames.length,
    dgdState, dgdShares,
    frames: frames.length,
    personalModel,
  }
}
