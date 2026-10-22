"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { updateThreshold } from "@/lib/focus/c4"
import { useAuth } from "./use-auth"
import { buildRun, gateAlerts } from "@/lib/demo/run"
import { saveRun, summarise } from "@/lib/demo/outcome"
import type {
  AlertResponse,
  DemoRun,
  Feedback,
  RaisedAlert,
  RunSummary,
  SessionConfig,
} from "@/lib/demo/types"

const ACTIVE_KEY = "ft_demo_active_run_v1"

interface DemoContextType {
  run: DemoRun | null
  cursor: number
  alerts: RaisedAlert[]
  threshold: number
  playing: boolean
  speed: number
  science: boolean
  preparing: boolean
  restoring: boolean
  feedbackDone: boolean
  summary: RunSummary | null
  start: (config: SessionConfig) => Promise<void>
  reset: () => void
  advance: () => void
  jumpTo: (i: number) => void
  jumpToNextAlert: () => void
  finish: () => void
  respond: (id: string, response: AlertResponse) => void
  setPlaying: (v: boolean) => void
  setSpeed: (v: number) => void
  setScience: (v: boolean) => void
  submitFeedback: (fb: Feedback) => void
}

const DemoContext = createContext<DemoContextType | null>(null)

function readActive(): DemoRun | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(ACTIVE_KEY)
    return raw ? (JSON.parse(raw) as DemoRun) : null
  } catch {
    return null
  }
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const { student, isLoading } = useAuth()
  const [run, setRun] = useState<DemoRun | null>(null)
  const [cursor, setCursor] = useState(0)
  const [alerts, setAlerts] = useState<RaisedAlert[]>([])
  const [threshold, setThreshold] = useState(0.5)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [science, setScience] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [restoring, setRestoring] = useState(true)
  const [feedbackDone, setFeedbackDone] = useState(false)

  // restore an unfinished run after a refresh (same tab)
  useEffect(() => {
    if (isLoading) return
    const active = readActive()
    if (active && student && active.studentId === student.id) {
      setRun(active)
      setThreshold(active.initialThreshold ?? 0.5)
    }
    setRestoring(false)
  }, [student, isLoading])

  const start = useCallback(
    async (config: SessionConfig) => {
      if (!student) return
      setPreparing(true)
      await new Promise((r) => setTimeout(r, 40))
      const next = buildRun(student, config)
      try {
        window.sessionStorage.setItem(ACTIVE_KEY, JSON.stringify(next))
      } catch {
        /* quota — run still works in memory */
      }
      setRun(next)
      setCursor(0)
      setAlerts([])
      setThreshold(next.initialThreshold)
      setPlaying(true)
      setFeedbackDone(false)
      setPreparing(false)
    },
    [student],
  )

  const reset = useCallback(() => {
    setRun(null)
    setCursor(0)
    setAlerts([])
    setThreshold(0.5)
    setPlaying(false)
    setFeedbackDone(false)
    try {
      window.sessionStorage.removeItem(ACTIVE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

  const advance = useCallback(() => {
    if (!run) return
    const next = Math.min(cursor + 1, run.frames.length - 1)
    if (next === cursor) {
      setPlaying(false)
      return
    }
    const f = run.frames[next]
    const last = alerts[alerts.length - 1]
    const gapOk = !last || next - last.t >= 10
    const budgetOk = alerts.filter((a) => a.t > next - 60).length < 3
    if (f.risk > threshold && next >= 3 && gapOk && budgetOk) {
      setAlerts((a) => [
        ...a,
        {
          id: `a${next}`,
          t: next,
          risk: f.risk,
          threshold,
          reasons: f.reasons,
          counterfactual: f.counterfactual,
          contributions: f.contributions,
          fusion: f.fusion,
          streams: f.streams,
          response: null,
        },
      ])
    }
    setCursor(next)
    if (next >= run.frames.length - 1) setPlaying(false)
  }, [run, cursor, alerts, threshold])

  const jumpTo = useCallback(
    (i: number) => {
      if (!run) return
      const next = Math.max(0, Math.min(i, run.frames.length - 1))
      const responses = Object.fromEntries(
        alerts.filter((a) => a.response).map((a) => [a.id, a.response as AlertResponse]),
      )
      setAlerts(gateAlerts(run, next, { threshold, maxPerHour: 3, showAlerts: true, minGapEpochs: 10 }, responses))
      setCursor(next)
    },
    [run, alerts, threshold],
  )

  const finish = useCallback(() => {
    if (!run) return
    // Extend the alert stream to the end without recomputing past alerts, so a
    // learner's "Helpful / Not now" answers survive into the outcomes page.
    const next = [...alerts]
    let last = next[next.length - 1]
    for (let i = cursor + 1; i < run.frames.length; i++) {
      const f = run.frames[i]
      const gapOk = !last || i - last.t >= 10
      const budgetOk = next.filter((a) => a.t > i - 60).length < 3
      if (f.risk > threshold && i >= 3 && gapOk && budgetOk) {
        const alert: RaisedAlert = {
          id: `a${i}`,
          t: i,
          risk: f.risk,
          threshold,
          reasons: f.reasons,
          counterfactual: f.counterfactual,
          contributions: f.contributions,
          fusion: f.fusion,
          streams: f.streams,
          response: null,
        }
        next.push(alert)
        last = alert
      }
    }
    setAlerts(next)
    setCursor(run.frames.length - 1)
    setPlaying(false)
  }, [run, cursor, alerts, threshold])

  const jumpToNextAlert = useCallback(() => {
    if (!run) return
    const last = alerts[alerts.length - 1]
    const start = Math.max(cursor + 1, last ? last.t + 10 : 3)
    for (let i = start; i < run.frames.length; i++) {
      if (run.frames[i].risk > threshold) {
        jumpTo(i)
        return
      }
    }
  }, [run, cursor, alerts, threshold, jumpTo])

  const respond = useCallback((id: string, response: AlertResponse) => {
    setAlerts((list) => list.map((a) => (a.id === id ? { ...a, response } : a)))
    setThreshold((t) => updateThreshold(t, response))
  }, [])

  const submitFeedback = useCallback(
    (fb: Feedback) => {
      if (!run || !student) return
      const summary = summarise(run, alerts, fb)
      saveRun(student, summary)
      setFeedbackDone(true)
      try {
        window.sessionStorage.removeItem(ACTIVE_KEY)
      } catch {
        /* ignore */
      }
    },
    [run, alerts, student],
  )

  const summary = useMemo(() => (run ? summarise(run, alerts) : null), [run, alerts])

  const value: DemoContextType = {
    run,
    cursor,
    alerts,
    threshold,
    playing,
    speed,
    science,
    preparing,
    restoring,
    feedbackDone,
    summary,
    start,
    reset,
    advance,
    jumpTo,
    jumpToNextAlert,
    finish,
    respond,
    setPlaying,
    setSpeed,
    setScience,
    submitFeedback,
  }

  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

export function useDemo() {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error("useDemo must be used inside DemoProvider")
  return ctx
}
