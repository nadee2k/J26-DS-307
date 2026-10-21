// Personal three-zone gaze model (screen / desk / away): multinomial logistic regression on
// [irisX, irisY, pitch, yaw], trained on the learner's own calibration frames. Weights are plain JSON so the
// model can be stored with the calibration record.

import type { ZoneModelJson } from "./types"

const FEATS = (f: { irisX: number; irisY: number; pitch: number; yaw: number }) => [f.irisX, f.irisY, f.pitch, f.yaw]

export function fitZoneModel(samples: { x: number[]; zone: number }[], K = 3, iters = 400, lr = 0.5, l2 = 0.01): ZoneModelJson {
  const d = samples[0].x.length
  const mu = Array.from({ length: d }, (_, j) => samples.reduce((s, r) => s + r.x[j], 0) / samples.length)
  const sg = Array.from({ length: d }, (_, j) => Math.sqrt(samples.reduce((s, r) => s + (r.x[j] - mu[j]) ** 2, 0) / samples.length) || 1)
  const X = samples.map((r) => r.x.map((v, j) => (v - mu[j]) / sg[j]))
  const W = Array.from({ length: K }, () => new Array(d + 1).fill(0))
  // class weights so a long screen segment does not drown the shorter desk/away segments
  const counts = Array.from({ length: K }, (_, k) => samples.filter((s) => s.zone === k).length)
  const cw = counts.map((c) => (c ? samples.length / (K * c) : 0))
  for (let it = 0; it < iters; it++) {
    const G = Array.from({ length: K }, () => new Array(d + 1).fill(0))
    X.forEach((x, i) => {
      const p = softmax(W.map((w) => w[0] + x.reduce((s, v, j) => s + v * w[j + 1], 0)))
      for (let k = 0; k < K; k++) {
        const err = (p[k] - (samples[i].zone === k ? 1 : 0)) * cw[samples[i].zone]
        G[k][0] += err
        for (let j = 0; j < d; j++) G[k][j + 1] += err * x[j]
      }
    })
    for (let k = 0; k < K; k++) for (let j = 0; j <= d; j++) W[k][j] -= lr * (G[k][j] / X.length + (j > 0 ? l2 * W[k][j] : 0))
  }
  return { mu, sg, W }
}

function softmax(z: number[]) {
  const m = Math.max(...z)
  const e = z.map((v) => Math.exp(v - m))
  const s = e.reduce((a, b) => a + b, 0)
  return e.map((v) => v / s)
}

export function zoneProbs(model: ZoneModelJson, f: { irisX: number; irisY: number; pitch: number; yaw: number }) {
  const x = FEATS(f).map((v, j) => (v - model.mu[j]) / model.sg[j])
  return softmax(model.W.map((w) => w[0] + x.reduce((s, v, j) => s + v * w[j + 1], 0)))
}

export function predictZone(model: ZoneModelJson, f: { irisX: number; irisY: number; pitch: number; yaw: number }) {
  const p = zoneProbs(model, f)
  let best = 0
  for (let k = 1; k < p.length; k++) if (p[k] > p[best]) best = k
  return { zone: best as 0 | 1 | 2, prob: p[best] }
}

export const zoneFeatures = FEATS
