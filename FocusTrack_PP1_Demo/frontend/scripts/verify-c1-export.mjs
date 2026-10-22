#!/usr/bin/env node
// Verify a C1 epoch export against the exact trained weights it was scored with.
//
// Usage:
//   node scripts/verify-c1-export.mjs focustrack_c1_epochs.json
//   node scripts/verify-c1-export.mjs focustrack_c1_epochs.json --json
//
// The export from /c1 contains `modelCheck` (C1, activity baseline and the C4 C1-only
// model). Exit code 0 = every stored score was reproduced; 1 = mismatch or bad file.

import { readFileSync } from "node:fs"

const args = process.argv.slice(2)
const json = args.includes("--json")
const path = args.find((a) => !a.startsWith("--"))
if (!path) {
  console.error("Usage: node scripts/verify-c1-export.mjs <focustrack_c1_epochs.json> [--json]")
  process.exit(2)
}

let data
try {
  data = JSON.parse(readFileSync(path, "utf8"))
} catch (error) {
  console.error(`Could not read ${path}: ${error.message}`)
  process.exit(2)
}

const epochs = Array.isArray(data.epochs) ? data.epochs : []
const modelCheck = data.modelCheck ?? (data.model ? { c1: data.model, baseline: data.model, focus00: data.model } : null)
if (!epochs.length) {
  console.error("No epochs found in this export.")
  process.exit(2)
}
if (!modelCheck?.c1) {
  console.error("This export has no model snapshot. Open /c1 again and use Download my data so the trained weights are included.")
  process.exit(2)
}

const screen = data.mode === "screen"
const sigmoid = (z) => 1 / (1 + Math.exp(-z))
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

function score(model, x) {
  if (!model?.w) throw new Error("model weights are missing")
  let z = model.w[0] ?? 0
  for (let j = 0; j < x.length; j++) {
    const mu = model.mu[j] ?? 0
    const sg = model.sg[j] || 1
    z += (model.w[j + 1] ?? 0) * ((x[j] - mu) / sg)
  }
  return sigmoid(z)
}

/** Mean of the last up-to-5 epochs, ending at index i (same as c1Smooth in the app). */
function smooth(epochs, i) {
  const win = epochs.slice(Math.max(0, i - 4), i + 1).map((e) => e.f)
  const avg = (key) => mean(win.map((f) => f[key]))
  return {
    typingRate: avg("typingRate"),
    interKeyVar: avg("interKeyVar"),
    backspaceRatio: avg("backspaceRatio"),
    idleRatio: avg("idleRatio"),
    mouseSpeed: avg("mouseSpeed"),
    switchRate: avg("switchRate"),
  }
}

function c1Vec(f, screen) {
  const s = screen ? 1 : 0
  return [
    f.typingRate, f.idleRatio, f.switchRate, f.mouseSpeed / 100,
    f.interKeyVar, f.backspaceRatio, s,
    s * f.typingRate, s * f.idleRatio, s * f.switchRate,
  ]
}

function baselineVec(f) {
  return [f.typingRate, f.idleRatio, f.mouseSpeed, f.switchRate]
}

function focus00Vec(f, screen) {
  const s = screen ? 1 : 0
  return [
    f.typingRate, f.idleRatio, f.switchRate, f.mouseSpeed / 100,
    0, 0, 0, 0, 0, 0, 0,
    s, s * f.typingRate, s * f.idleRatio, 0, 0, 0,
  ]
}

const mismatches = []
let maxDiff = 0
for (let i = 0; i < epochs.length; i++) {
  const expected = score(modelCheck.c1, c1Vec(smooth(epochs, i), screen))
  const stored = Number(epochs[i].p)
  const diff = Math.abs(expected - stored)
  maxDiff = Math.max(maxDiff, diff)
  if (!Number.isFinite(stored) || diff > 1e-9) mismatches.push({ epoch: i + 1, stored, expected, diff })
}

const latestIndex = epochs.length - 1
const latestSmooth = smooth(epochs, latestIndex)
const latest = {
  baseline: score(modelCheck.baseline, baselineVec(latestSmooth)),
  c1: score(modelCheck.c1, c1Vec(latestSmooth, screen)),
  c4: modelCheck.focus00 ? score(modelCheck.focus00, focus00Vec(latestSmooth, screen)) : null,
}

const labels = {
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
const x = c1Vec(latestSmooth, screen)
const z = x.map((v, j) => (v - (modelCheck.c1.mu[j] ?? 0)) / (modelCheck.c1.sg[j] || 1))
const contributions = modelCheck.c1.names
  .map((name, j) => ({ feature: name, label: labels[name] ?? name, value: (modelCheck.c1.w[j + 1] ?? 0) * z[j] }))
  .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
const up = contributions.filter((c) => c.value > 0).slice(0, 3)
const down = contributions.filter((c) => c.value < 0).slice(0, 3)

const result = {
  ok: mismatches.length === 0,
  epochs: epochs.length,
  mode: data.mode ?? null,
  maxDiff,
  mismatches,
  latest,
  contributions: { up, down },
  trainedOn: modelCheck.trainedOn ?? "unknown",
}

if (json) {
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
}

console.log("FocusTrack C1 export check")
console.log(`  file: ${path}`)
console.log(`  mode: ${data.mode ?? "unknown"} · epochs: ${epochs.length} · trained on: ${result.trainedOn}`)
console.log(`  score reproduction: ${result.ok ? "PASS" : "FAIL"} (max |diff| ${maxDiff.toExponential(2)})`)
if (!result.ok) {
  console.log("  mismatches:")
  for (const m of mismatches.slice(0, 8)) console.log(`    epoch ${m.epoch}: stored ${m.stored.toFixed(6)}, recomputed ${m.expected.toFixed(6)}`)
}
console.log("  latest epoch:")
console.log(`    simple activity counts   ${latest.baseline.toFixed(3)}`)
console.log(`    trained C1               ${latest.c1.toFixed(3)}`)
if (latest.c4 != null) console.log(`    C4 fusion (C1 only)      ${latest.c4.toFixed(3)}`)
if (up.length) console.log(`  pushing up:   ${up.map((c) => `${c.label} (${c.value.toFixed(2)})`).join(", ")}`)
if (down.length) console.log(`  pulling down: ${down.map((c) => `${c.label} (${c.value.toFixed(2)})`).join(", ")}`)
console.log(result.ok ? "\nAll stored scores were reproduced from the trained model." : "\nSome scores were not reproduced. Re-export from /c1 with the current build.")
process.exit(result.ok ? 0 : 1)
