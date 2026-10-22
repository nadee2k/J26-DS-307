// Component 2 – sensor calibration, cleaning (Hampel filter), one-epoch aggregation and personal comfort bands.

import type { EnvReading } from "./buffers"
import type { C2Features } from "./types"

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }

// ---------- sensor calibration ----------
// The ESP32 sends raw 12-bit ADC values for the LDR and the sound sensor (0–4095). They are mapped to approximate
// lux and dB(A) with two reference points per sensor, measured once against a lux meter and a sound-level meter.
export interface SensorCalibration {
  light: [{ raw: number; value: number }, { raw: number; value: number }] // value in lux
  sound: [{ raw: number; value: number }, { raw: number; value: number }] // raw = peak-to-peak ADC, value in dB(A)
  measured: boolean // false = placeholder defaults, not yet measured against reference meters
}
const KEY = "focustrack_sensor_calibration_v1"
export const DEFAULT_CALIBRATION: SensorCalibration = {
  light: [{ raw: 400, value: 50 }, { raw: 3200, value: 600 }],
  sound: [{ raw: 20, value: 35 }, { raw: 900, value: 75 }],
  measured: false,
}
export function loadCalibration(): SensorCalibration {
  try { const raw = window.localStorage.getItem(KEY); if (raw) return JSON.parse(raw) } catch { /* use defaults */ }
  return DEFAULT_CALIBRATION
}
export function saveCalibration(c: SensorCalibration) {
  try { window.localStorage.setItem(KEY, JSON.stringify(c)) } catch { /* ignore */ }
}
/** Light is roughly linear in ADC counts over the indoor range; loudness is linear in log10(peak-to-peak amplitude). */
export function toLux(raw: number, c: SensorCalibration) {
  const [a, b] = c.light
  return Math.max(0, a.value + ((raw - a.raw) * (b.value - a.value)) / (b.raw - a.raw))
}
export function toDb(raw: number, c: SensorCalibration) {
  const [a, b] = c.sound
  const la = Math.log10(Math.max(a.raw, 1)), lb = Math.log10(Math.max(b.raw, 1))
  return a.value + ((Math.log10(Math.max(raw, 1)) - la) * (b.value - a.value)) / (lb - la)
}

// ---------- cleaning ----------
/** Hampel filter: replace points further than k scaled MADs from the rolling median with null (treated as missing). */
export function hampel(xs: (number | null)[], half = 3, k = 3) {
  let removed = 0
  const out = xs.map((v, i) => {
    if (v == null) return null
    const win = xs.slice(Math.max(0, i - half), i + half + 1).filter((x): x is number => x != null)
    if (win.length < 3) return v
    const med = median(win)
    const mad = 1.4826 * median(win.map((x) => Math.abs(x - med)))
    if (mad > 0 && Math.abs(v - med) > k * mad) { removed++; return null }
    return v
  })
  return { values: out, removed }
}

const slopePerMinute = (pts: { t: number; v: number }[]) => {
  if (pts.length < 3) return null
  const t0 = pts[0].t
  const xs = pts.map((p) => (p.t - t0) / 60000), ys = pts.map((p) => p.v)
  const mx = mean(xs), my = mean(ys)
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0)
  return sxx ? xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / sxx : 0
}

export interface ComfortBand { noise: [number, number]; temp: [number, number]; personal: boolean; basis: number }

const outside = (v: number | null, band: [number, number]) => (v == null ? 0 : v < band[0] ? band[0] - v : v > band[1] ? v - band[1] : 0)

export function aggregateC2(readings: EnvReading[], from: number, to: number, band: ComfortBand): C2Features | null {
  const expected = Math.max(1, Math.round((to - from) / 1000))
  if (!readings.length) return null
  const clean = (key: "temp" | "humidity" | "light" | "noise") => hampel(readings.map((r) => r[key]))
  const T = clean("temp"), H = clean("humidity"), L = clean("light"), N = clean("noise")
  const vals = (c: { values: (number | null)[] }) => c.values.filter((v): v is number => v != null)
  const m = (c: { values: (number | null)[] }) => { const v = vals(c); return v.length ? mean(v) : null }
  const noiseVals = vals(N)
  const temp = m(T), noise = m(N)
  const complete = readings.filter((r) => r.temp != null && r.noise != null).length
  return {
    temp, humidity: m(H), light: m(L), noise,
    motion: readings.filter((r) => r.motion).length / readings.length,
    noiseSd: noiseVals.length > 1 ? Math.sqrt(mean(noiseVals.map((v) => (v - mean(noiseVals)) ** 2))) : null,
    tempSlope: slopePerMinute(readings.map((r, i) => ({ t: r.t, v: T.values[i] })).filter((p): p is { t: number; v: number } => p.v != null)),
    readings: readings.length,
    missingRatio: Math.max(0, 1 - complete / expected),
    outliersRemoved: T.removed + H.removed + L.removed + N.removed,
    comfortNoise: outside(noise, band.noise),
    comfortTemp: outside(temp, band.temp),
    calibrated: readings.every((r) => r.calibrated),
  }
}

const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] }

/**
 * Personal comfort band: 10th–90th percentile of noise and temperature in the learner's highest-focus epochs
 * (epochs in the 5 minutes before a probe with z > 0) from EARLIER sessions only. Falls back to the population
 * band until there are at least 8 such epochs.
 */
export function comfortBand(goodEpochs: { noise: number | null; temp: number | null }[], population: ComfortBand): ComfortBand {
  const n = goodEpochs.map((e) => e.noise).filter((v): v is number => v != null)
  const t = goodEpochs.map((e) => e.temp).filter((v): v is number => v != null)
  if (n.length < 8 || t.length < 8) return { ...population, personal: false, basis: Math.min(n.length, t.length) }
  return { noise: [quantile(n, 0.1), quantile(n, 0.9)], temp: [quantile(t, 0.1), quantile(t, 0.9)], personal: true, basis: n.length }
}
