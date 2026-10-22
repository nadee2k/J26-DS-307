import type { DemoRun, Feedback, RaisedAlert, RunSummary, SavedRun, Student } from "./types"
import { hash } from "./run"

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/** Collapse minute-by-minute wording into one category so the outcome does not repeat "noise is 52, 54, 53". */
function reasonCategory(reason: string) {
  if (/^noise/i.test(reason)) return "noise"
  if (/^room temperature/i.test(reason)) return "temperature"
  if (/minutes on task/i.test(reason)) return "time on task"
  if (/phone/i.test(reason)) return "phone"
  if (/looking away/i.test(reason)) return "looking away"
  if (/switching/i.test(reason)) return "app switching"
  if (/keyboard or mouse/i.test(reason)) return "idle"
  if (/quiet stretch/i.test(reason)) return "quiet"
  if (/typing rhythm/i.test(reason)) return "typing"
  if (/mouse activity/i.test(reason)) return "mouse"
  if (/reading movement/i.test(reason)) return "reading"
  if (/focus rating/i.test(reason)) return "self-report"
  return reason
}

export function summarise(run: DemoRun, alerts: RaisedAlert[], feedback?: Feedback): RunSummary {
  const frames = run.frames
  const focus = frames.map((f) => f.focusProb * 100)
  let best = 0
  for (let i = 0; i < focus.length; i++) {
    if (i < 4) continue
    best = Math.max(best, avg(focus.slice(i - 4, i + 1)))
  }

  let interruptions = 0
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1].stateLabel
    const b = frames[i].stateLabel
    if (a !== b && (b.includes("Leaving") || b.includes("Idle"))) interruptions++
  }

  const stateCount = new Map<string, number>()
  for (const f of frames) stateCount.set(f.stateLabel, (stateCount.get(f.stateLabel) ?? 0) + 1)
  const stateShares = [...stateCount.entries()]
    .map(([label, n]) => ({ label, share: n / Math.max(1, frames.length) }))
    .sort((a, b) => b.share - a.share)

  const reasonCount = new Map<string, number>()
  const reasonLabel = new Map<string, string>()
  for (const f of frames) {
    for (const r of f.reasons) {
      const key = reasonCategory(r)
      reasonCount.set(key, (reasonCount.get(key) ?? 0) + 1)
      if (!reasonLabel.has(key)) reasonLabel.set(key, r)
    }
  }
  const topReasons = [...reasonCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => reasonLabel.get(key) ?? key)

  const drops = run.probes.filter((p) => p.drop)
  const hits = alerts.filter((a) => drops.some((d) => d.t - a.t >= 4 && d.t - a.t <= 10)).length
  const acted = alerts.filter((a) => a.response === "helpful").length
  const quiet = run.mode === "non-screen"
  const top = topReasons[0]

  let hero: string
  if (quiet) {
    hero =
      drops.length === 0
        ? avg(focus) >= 60
          ? "A calm, consistent reading session. The quiet stretches that look like distraction were part of the work."
          : "A quiet reading session. The quiet stretches that look like distraction were part of the work, and the paper-work context kept the estimate from misreading them."
        : "You kept a steady reading rhythm. The dip came later in the session, and the paper-work context kept the estimate from misreading quiet time as distraction."
  } else if (avg(focus) >= 68) {
    hero = drops.length
      ? "A strong session overall. The one dip followed the conditions shown below, and a short reset brought you back."
      : "A strong, consistent session with no sustained drop in focus. Your rhythm held from start to finish."
  } else {
    hero = drops.length
      ? `You worked through a session with ${drops.length === 1 ? "one dip" : `${drops.length} dips`}. ${top ? `The strongest early signal was: ${top}.` : ""}`
      : "A mixed session. There was useful work in it, and the signals point to what to change next time."
  }

  return {
    id: run.id,
    createdAt: run.createdAt,
    config: run.config,
    mode: run.mode,
    avgFocus: Math.round(avg(focus)),
    bestWindow: Math.round(best),
    interruptions,
    alerts: alerts.length,
    alertsActed: acted,
    hits,
    probes: run.probes.length,
    drops: drops.length,
    stateShares,
    topReasons,
    noise: Math.round(avg(frames.map((f) => f.env.noise))),
    temp: Number(avg(frames.map((f) => f.env.temp)).toFixed(1)),
    phoneShare: avg(frames.map((f) => f.vision.phoneInFrame)),
    hero,
    feedback,
  }
}

const HISTORY_KEY = "ft_demo_history_v1"

type HistoryMap = Record<string, SavedRun[]>

function loadHistory(): HistoryMap {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY)
    if (raw) return JSON.parse(raw) as HistoryMap
  } catch {
    /* empty */
  }
  return {}
}

function saveHistory(map: HistoryMap) {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(map))
  } catch {
    /* storage unavailable */
  }
}

const DAY = 86_400_000

/** Deterministic previous sessions so the progress page is populated on first visit. */
function seedHistory(student: Student): SavedRun[] {
  const h = hash(student.id + student.name)
  const base = 52 + (h % 14)
  const modes = ["screen", "non-screen", "screen", "screen"] as const
  return Array.from({ length: 4 }, (_, i) => {
    const jitter = ((h >> (i * 3)) % 11) - 5
    const avgFocus = Math.max(38, Math.min(82, base + i * 3 + jitter))
    const created = new Date(Date.now() - (4 - i) * 3 * DAY).toISOString()
    return {
      id: `seed-${student.id}-${i}`,
      studentId: student.id,
      createdAt: created,
      config: {
        task: modes[i] === "screen" ? "coding" : "reading",
        place: i % 2 === 0 ? "library" : "home",
        minutes: 50,
        streams: { c2: true, c3: true },
      },
      mode: modes[i],
      avgFocus,
      bestWindow: Math.min(92, avgFocus + 11),
      interruptions: 2 + (i % 3),
      alerts: 1 + (i % 2),
      alertsActed: i % 2,
      hits: i % 2,
      probes: 4,
      drops: 1,
      stateShares: [
        { label: modes[i] === "screen" ? "Sustained typing" : "Reading / paper work", share: 0.56 },
        { label: "Browsing / watching on screen", share: 0.2 },
        { label: "Idle / away from the computer", share: 0.16 },
        { label: "Leaving the app often", share: 0.08 },
      ],
      topReasons: modes[i] === "screen" ? ["app switching", "Noise above your comfort range"] : ["time on task"],
      noise: 42 + (i % 4),
      temp: 25 + i * 0.3,
      phoneShare: 0.04 * i,
      hero: "",
    }
  })
}

export function getHistory(student: Student): SavedRun[] {
  const map = loadHistory()
  if (!map[student.id]?.length) {
    map[student.id] = seedHistory(student)
    saveHistory(map)
  }
  return [...map[student.id]].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function saveRun(student: Student, summary: RunSummary) {
  const map = loadHistory()
  const list = getHistory(student).filter((r) => r.id !== summary.id)
  list.push({ ...summary, studentId: student.id })
  map[student.id] = list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  saveHistory(map)
}

export function nextAction(history: SavedRun[]): string {
  if (history.length < 2) return "Complete one more session so FocusTrack can compare your rhythms."
  const last = history[history.length - 1]
  const prev = history[history.length - 2]
  if (last.alerts > 0 && last.alertsActed === 0) return "Try responding to one alert next session — it tunes your own alert level."
  if (last.noise > 46) return "Your last session was noisy. A quieter place, or noise-cancelling headphones, may protect your focus."
  if (last.phoneShare > 0.12) return "Your phone was in view for part of the session. Keeping it out of frame is the single easiest change."
  if (last.avgFocus > prev.avgFocus) return "You are trending upward. Keep the same place and time for the next session."
  return "Try a shorter session with one clear task, then compare the outcome."
}
